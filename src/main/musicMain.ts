import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  net,
  protocol,
} from 'electron';
import Database from 'better-sqlite3';
import { MUSIC_CHANNELS, MusicResult } from '../constants/musicIpc';
import {
  createMusicCatalog,
  initializeMusicCatalog,
  TagKind,
} from './musicCatalog';
import { scanMusicRoot } from './musicScanner';
import { createMusicTagManager } from './musicTagManager';
import { MusicTagEdit } from './musicTags';
import { createMusicPlayback } from './musicPlayback';
import { resolveHtmlPath } from './util';
import loadMusicWindow from './musicWindow';

let mainWindow: BrowserWindow | null = null;
let activeScan: AbortController | null = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'music-audio',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);

function validId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function validKind(value: unknown): value is TagKind {
  return value === 'artist' || value === 'genre';
}

function validTagName(value: unknown): value is string {
  return (
    typeof value === 'string' && !!value.trim() && value.trim().length <= 200
  );
}

function validateEdit(input: unknown): MusicTagEdit {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid tag changes.');
  }
  const fields = Object.entries(input);
  if (
    !fields.length ||
    fields.some(([key, value]) => {
      if (['title', 'album'].includes(key)) {
        return typeof value !== 'string' || value.length > 500;
      }
      if (['artists', 'genres'].includes(key)) {
        return (
          !Array.isArray(value) ||
          value.length > 50 ||
          value.some(
            (name) =>
              typeof name !== 'string' || !name.trim() || name.length > 200,
          )
        );
      }
      if (['year', 'track'].includes(key)) {
        return (
          !Number.isInteger(value) ||
          (value as number) < 0 ||
          (value as number) > 3000
        );
      }
      return true;
    })
  ) {
    throw new Error('Invalid tag changes.');
  }
  return input as MusicTagEdit;
}

app
  .whenReady()
  .then(async () => {
    const databasePath = path.join(app.getPath('userData'), 'music-catalog.db');
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const database = new Database(databasePath);
    try {
      const schemaPath = app.isPackaged
        ? path.join(process.resourcesPath, 'data', 'music', '001_initial.sql')
        : path.join(app.getAppPath(), 'data', 'music', '001_initial.sql');
      initializeMusicCatalog(database, fs.readFileSync(schemaPath, 'utf8'));
    } catch (error) {
      database.close();
      process.stderr.write(
        `Music catalog startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      dialog.showErrorBox(
        'Cannot open music catalog',
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
      return undefined;
    }
    const catalog = createMusicCatalog(database);
    const tagManager = createMusicTagManager(catalog);
    const playback = createMusicPlayback(catalog, (url, request) =>
      net.fetch(url, {
        method: request.method,
        headers: request.headers,
        signal: request.signal,
      }),
    );
    protocol.handle('music-audio', (request) => playback.serve(request));
    app.on('before-quit', () => {
      activeScan?.abort();
      playback.clear();
      database.close();
    });

    const fromWindow = (event: IpcMainInvokeEvent) =>
      Boolean(mainWindow) &&
      event.sender === mainWindow?.webContents &&
      event.senderFrame === mainWindow?.webContents.mainFrame;
    const handle = <T>(
      channel: string,
      action: (...args: unknown[]) => T | Promise<T>,
    ) => {
      ipcMain.handle(
        channel,
        async (event, ...args): Promise<MusicResult<T>> => {
          if (!fromWindow(event)) {
            return {
              ok: false,
              error: { code: 'UNAVAILABLE', message: 'Request denied.' },
            };
          }
          try {
            return { ok: true, data: await action(...args) };
          } catch (error) {
            return {
              ok: false,
              error: {
                code: 'FAILED',
                message:
                  error instanceof Error ? error.message : 'Operation failed.',
              },
            };
          }
        },
      );
    };

    handle(MUSIC_CHANNELS.ROOTS, () => catalog.roots());
    handle(MUSIC_CHANNELS.PLAYBACK_SOURCE, (id) => {
      if (!validId(id)) throw new Error('Invalid track ID.');
      return playback.source(id);
    });
    handle(MUSIC_CHANNELS.CHOOSE_ROOT, async () => {
      if (!mainWindow) throw new Error('Window unavailable.');
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Add music folder',
        properties: ['openDirectory'],
      });
      if (result.canceled || !result.filePaths.length) return null;
      const root = fs.realpathSync(result.filePaths[0]);
      const id = catalog.addRoot(root);
      return { id, root_path: root };
    });
    handle(MUSIC_CHANNELS.SCAN, async (rootId) => {
      if (!validId(rootId)) throw new Error('Invalid source root.');
      const root = catalog.roots().find(({ id }) => id === rootId);
      if (!root) throw new Error('Source root not found.');
      if (activeScan) throw new Error('A scan is already running.');
      const controller = new AbortController();
      activeScan = controller;
      try {
        return await scanMusicRoot(
          catalog,
          root.root_path,
          controller.signal,
          true,
        );
      } finally {
        activeScan = null;
      }
    });
    handle(MUSIC_CHANNELS.CANCEL_SCAN, () => {
      if (!activeScan) return false;
      activeScan.abort();
      return true;
    });
    handle(MUSIC_CHANNELS.SEARCH, (text, limit, offset) => {
      if (
        typeof text !== 'string' ||
        typeof limit !== 'number' ||
        typeof offset !== 'number'
      ) {
        throw new Error('Invalid search request.');
      }
      return catalog.search(text, limit, offset);
    });
    handle(MUSIC_CHANNELS.DETAIL, (id) => {
      if (!validId(id)) throw new Error('Invalid track ID.');
      return catalog.detail(id) ?? null;
    });
    handle(MUSIC_CHANNELS.EDIT, (id, input) => {
      if (!validId(id)) throw new Error('Invalid track ID.');
      const changes = validateEdit(input);
      return tagManager.saveTrack(id, changes);
    });
    handle(MUSIC_CHANNELS.TAGS, (kind) => {
      if (!validKind(kind)) throw new Error('Invalid tag kind.');
      return catalog.tags(kind);
    });
    handle(MUSIC_CHANNELS.TAG_SONGS, (kind, id, limit, offset) => {
      if (
        !validKind(kind) ||
        !validId(id) ||
        typeof limit !== 'number' ||
        typeof offset !== 'number'
      )
        throw new Error('Invalid tag song request.');
      return catalog.tagSongs(kind, id, limit, offset);
    });
    handle(MUSIC_CHANNELS.ADD_TAG, (kind, name) => {
      if (!validKind(kind) || !validTagName(name))
        throw new Error('Invalid tag name.');
      return catalog.addTag(kind, name);
    });
    handle(MUSIC_CHANNELS.MOVE_TAG, (kind, sourceId, destinationName) => {
      if (
        !validKind(kind) ||
        !validId(sourceId) ||
        !validTagName(destinationName)
      ) {
        throw new Error('Invalid tag change.');
      }
      if (activeScan) throw new Error('Finish the scan before editing tags.');
      return tagManager.move(kind, sourceId, destinationName);
    });

    mainWindow = new BrowserWindow({
      width: 1180,
      height: 780,
      minWidth: 720,
      minHeight: 520,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.on('closed', () => {
      playback.clear();
      mainWindow = null;
    });
    await loadMusicWindow(mainWindow, resolveHtmlPath('index.html'));
    return undefined;
  })
  .catch((error) => {
    process.stderr.write(
      `Music window startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    dialog.showErrorBox(
      'Cannot start music collection',
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
