import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
} from 'electron';
import Database from 'better-sqlite3';
import { MUSIC_CHANNELS, MusicResult } from '../constants/musicIpc';
import { createMusicCatalog, initializeMusicCatalog } from './musicCatalog';
import { scanMusicRoot } from './musicScanner';
import { MusicTagEdit, writeMusicTags } from './musicTags';
import { resolveHtmlPath } from './util';

let mainWindow: BrowserWindow | null = null;
let activeScan: AbortController | null = null;

function validId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
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
      dialog.showErrorBox(
        'Cannot open music catalog',
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
      return undefined;
    }
    const catalog = createMusicCatalog(database);
    app.on('before-quit', () => {
      activeScan?.abort();
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
        return await scanMusicRoot(catalog, root.root_path, controller.signal);
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
      const track = catalog.detail(id);
      if (!track || track.status !== 'present')
        throw new Error('Track is unavailable.');
      const root = catalog
        .roots()
        .find(({ id: rootId }) => rootId === track.source_id);
      if (!root) throw new Error('Source root is unavailable.');
      const actualPath = fs.realpathSync(track.path);
      const relative = path.relative(root.root_path, actualPath);
      if (
        !relative ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        throw new Error('Track is outside its source root.');
      }
      const before = fs.statSync(actualPath);
      if (
        before.size !== track.size_bytes ||
        before.mtimeMs !== track.mtime_ms
      ) {
        throw new Error('Track changed on disk. Rescan before editing.');
      }
      const saved = writeMusicTags(actualPath, changes);
      const after = fs.statSync(actualPath);
      catalog.upsertTrack({
        sourceId: track.source_id,
        filePath: track.path,
        sizeBytes: after.size,
        mtimeMs: after.mtimeMs,
        tags: saved,
      });
      return catalog.detail(id)!;
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
      mainWindow = null;
    });
    await mainWindow.loadURL(resolveHtmlPath('index.html'));
    return undefined;
  })
  .catch((error) => {
    dialog.showErrorBox(
      'Cannot start music collection',
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
