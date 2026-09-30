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
import {
  MUSIC_CHANNELS,
  MusicResult,
  MusicExportRequest,
} from '../constants/musicIpc';
import {
  createMusicCatalog,
  initializeMusicCatalog,
  CompletionistPlaylistRequest,
  FilteredPlaylistRequest,
  PlaybackStateUpdate,
  TagKind,
  TrackRatingFilter,
  validateTrackFilter,
} from './musicCatalog';
import { scanMusicRoot } from './musicScanner';
import { createMusicTagManager } from './musicTagManager';
import { MusicTagEdit } from './musicTags';
import { createMusicPlayback } from './musicPlayback';
import { resolveHtmlPath } from './util';
import loadMusicWindow from './musicWindow';
import { collectExportTracks, copyExportTracks } from './musicExport';

let mainWindow: BrowserWindow | null = null;
let activeScan: AbortController | null = null;
let exporting = false;

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

function validRatingFilter(value: unknown): value is TrackRatingFilter {
  return (
    value === 'all' ||
    value === '5-star' ||
    value === '4-star' ||
    value === '3-star' ||
    value === 'lower'
  );
}

function validTagName(value: unknown): value is string {
  return (
    typeof value === 'string' && !!value.trim() && value.trim().length <= 200
  );
}

function validateExportRequest(input: unknown): MusicExportRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid export request.');
  const request = input as Record<string, unknown>;
  if (request.kind === 'playlist' && validId(request.id)) {
    return { kind: 'playlist', id: request.id };
  }
  throw new Error('Invalid export request.');
}

function validIdList(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(validId) &&
    new Set(value).size === value.length
  );
}

function validateCompletionistRequest(
  input: unknown,
): CompletionistPlaylistRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid completionist playlist request.');
  const request = input as Record<string, unknown>;
  if (
    !validTagName(request.name) ||
    !validRatingFilter(request.ratingFilter) ||
    !validIdList(request.requiredGenreIds) ||
    !validIdList(request.excludedGenreIds) ||
    typeof request.targetMinutes !== 'number' ||
    !Number.isSafeInteger(request.targetMinutes) ||
    request.targetMinutes < 1 ||
    request.targetMinutes > Number.MAX_SAFE_INTEGER / 60_000
  ) {
    throw new Error('Invalid completionist playlist request.');
  }
  return {
    name: request.name,
    ratingFilter: request.ratingFilter,
    requiredGenreIds: request.requiredGenreIds,
    excludedGenreIds: request.excludedGenreIds,
    targetMinutes: request.targetMinutes,
  };
}

function validateFilteredPlaylistRequest(
  input: unknown,
): FilteredPlaylistRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid filtered playlist request.');
  const request = input as Record<string, unknown>;
  if (
    Object.keys(request).some((key) => !['name', 'filter'].includes(key)) ||
    !validTagName(request.name)
  ) {
    throw new Error('Invalid filtered playlist request.');
  }
  return {
    name: request.name.trim(),
    filter: validateTrackFilter(request.filter),
  };
}

function validatePlaybackStateUpdate(input: unknown): PlaybackStateUpdate {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid playback state.');
  const { trackId, positionSeconds, volume } = input as Record<string, unknown>;
  if (
    (trackId !== null && !validId(trackId)) ||
    typeof positionSeconds !== 'number' ||
    !Number.isFinite(positionSeconds) ||
    positionSeconds < 0 ||
    typeof volume !== 'number' ||
    !Number.isFinite(volume) ||
    volume < 0 ||
    volume > 1
  ) {
    throw new Error('Invalid playback state.');
  }
  return {
    trackId,
    positionSeconds,
    volume,
  };
}

function validateEdit(input: unknown): MusicTagEdit {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid tag changes.');
  }
  const fields = Object.entries(input);
  if (
    !fields.length ||
    fields.some(([key, value]) => {
      if (['isDad', 'isMlp'].includes(key)) return typeof value !== 'boolean';
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
    handle(MUSIC_CHANNELS.EXPORT_FILES, async (input) => {
      const request = validateExportRequest(input);
      const window = mainWindow;
      if (!window) throw new Error('Window unavailable.');
      if (exporting) throw new Error('An export is already running.');
      if (activeScan)
        throw new Error('Finish the scan before exporting files.');
      exporting = true;
      try {
        const tracks = collectExportTracks(catalog, request);
        if (!tracks.length) throw new Error('No matching files to export.');
        const chosen = await dialog.showOpenDialog(window, {
          title: 'Choose export destination',
          properties: ['openDirectory', 'createDirectory'],
        });
        if (chosen.canceled || !chosen.filePaths.length) return null;
        const destination = fs.realpathSync(chosen.filePaths[0]);
        const confirmation = await dialog.showMessageBox(window, {
          type: 'question',
          title: 'Confirm file export',
          message: `Copy ${tracks.length} matching file${tracks.length === 1 ? '' : 's'} to this directory?`,
          detail: `${destination}\n\nExisting files will not be replaced. Duplicate names get numbered suffixes. Unavailable files will be reported.`,
          buttons: ['Cancel', 'Copy files'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (confirmation.response !== 1) return null;
        return await copyExportTracks(
          catalog,
          tracks,
          destination,
          (progress) => {
            if (!window.isDestroyed())
              window.webContents.send(MUSIC_CHANNELS.EXPORT_PROGRESS, progress);
          },
        );
      } finally {
        exporting = false;
      }
    });
    handle(MUSIC_CHANNELS.PLAYBACK_STATE, () => catalog.playbackState());
    handle(MUSIC_CHANNELS.SAVE_PLAYBACK_STATE, (input) =>
      catalog.savePlaybackState(validatePlaybackStateUpdate(input)),
    );
    handle(MUSIC_CHANNELS.PLAYBACK_SOURCE, (id) => {
      if (!validId(id)) throw new Error('Invalid track ID.');
      return playback.source(id);
    });
    handle(MUSIC_CHANNELS.RANDOM_TRACK, () => catalog.randomTrack());
    handle(MUSIC_CHANNELS.PLAYLISTS, () => catalog.playlists());
    handle(MUSIC_CHANNELS.CREATE_PLAYLIST, (name) => {
      if (!validTagName(name)) throw new Error('Invalid playlist name.');
      return catalog.createPlaylist(name);
    });
    handle(MUSIC_CHANNELS.RENAME_PLAYLIST, (id, name) => {
      if (!validId(id) || !validTagName(name))
        throw new Error('Invalid playlist change.');
      return catalog.renamePlaylist(id, name);
    });
    handle(MUSIC_CHANNELS.DELETE_PLAYLIST, (id) => {
      if (!validId(id)) throw new Error('Invalid playlist ID.');
      return catalog.deletePlaylist(id);
    });
    handle(MUSIC_CHANNELS.PLAYLIST_TRACKS, (id) => {
      if (!validId(id)) throw new Error('Invalid playlist ID.');
      return catalog.playlistTracks(id);
    });
    handle(MUSIC_CHANNELS.TRACK_PLAYLISTS, (id) => {
      if (!validId(id)) throw new Error('Invalid track ID.');
      return catalog.trackPlaylists(id);
    });
    handle(MUSIC_CHANNELS.ADD_PLAYLIST_TRACK, (playlistId, trackId) => {
      if (!validId(playlistId) || !validId(trackId))
        throw new Error('Invalid playlist track request.');
      return catalog.addPlaylistTrack(playlistId, trackId);
    });
    handle(MUSIC_CHANNELS.REMOVE_PLAYLIST_TRACK, (playlistId, trackId) => {
      if (!validId(playlistId) || !validId(trackId))
        throw new Error('Invalid playlist track request.');
      return catalog.removePlaylistTrack(playlistId, trackId);
    });
    handle(
      MUSIC_CHANNELS.MOVE_PLAYLIST_TRACK,
      (playlistId, trackId, position) => {
        if (
          !validId(playlistId) ||
          !validId(trackId) ||
          typeof position !== 'number' ||
          !Number.isSafeInteger(position) ||
          position < 0
        ) {
          throw new Error('Invalid playlist order request.');
        }
        return catalog.movePlaylistTrack(playlistId, trackId, position);
      },
    );
    handle(MUSIC_CHANNELS.CREATE_COMPLETIONIST_PLAYLIST, (input) =>
      catalog.createCompletionistPlaylist(validateCompletionistRequest(input)),
    );
    handle(MUSIC_CHANNELS.FILTER_TRACKS, (input, limit, offset) => {
      const filter = validateTrackFilter(input);
      if (
        typeof limit !== 'number' ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        typeof offset !== 'number' ||
        !Number.isSafeInteger(offset) ||
        offset < 0
      ) {
        throw new Error('Invalid filtered track pagination.');
      }
      return catalog.filterTracks(filter, limit, offset);
    });
    handle(MUSIC_CHANNELS.CREATE_FILTERED_PLAYLIST, (input) => {
      const request = validateFilteredPlaylistRequest(input);
      return catalog.createFilteredPlaylist(request.name, request.filter);
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
      if (exporting) throw new Error('Finish the export before scanning.');
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
    handle(MUSIC_CHANNELS.SEARCH, (text, limit, offset, ratingFilter) => {
      if (
        typeof text !== 'string' ||
        typeof limit !== 'number' ||
        typeof offset !== 'number' ||
        !validRatingFilter(ratingFilter)
      ) {
        throw new Error('Invalid search request.');
      }
      return catalog.search(text, limit, offset, ratingFilter);
    });
    handle(MUSIC_CHANNELS.DETAIL, (id) => {
      if (!validId(id)) throw new Error('Invalid track ID.');
      return catalog.detail(id) ?? null;
    });
    handle(MUSIC_CHANNELS.EDIT, (id, input) => {
      if (exporting) throw new Error('Finish the export before editing tags.');
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
      if (exporting) throw new Error('Finish the export before editing tags.');
      return tagManager.move(kind, sourceId, destinationName);
    });

    mainWindow = new BrowserWindow({
      width: 1180,
      height: 780,
      minWidth: 720,
      minHeight: 520,
      icon: app.isPackaged
        ? path.join(process.resourcesPath, 'assets', 'icon.png')
        : path.join(app.getAppPath(), 'assets', 'icon.png'),
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
