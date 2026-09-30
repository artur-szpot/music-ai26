/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  WebContents,
  IpcMainInvokeEvent,
} from 'electron';
import {
  MUSIC_CHANNELS,
  MusicExportResult,
  MusicResult,
} from '../constants/musicIpc';
import { collectExportTracks, copyExportTracks } from '../main/musicExport';

const mockCatalog = {
  filterTracks: jest.fn(),
  createFilteredPlaylist: jest.fn(),
};

jest.mock('electron', () => ({
  app: {
    whenReady: jest.fn().mockResolvedValue(undefined),
    getPath: jest.fn(),
    getAppPath: jest.fn(() => process.cwd()),
    on: jest.fn(),
    quit: jest.fn(),
    isPackaged: false,
  },
  BrowserWindow: jest.fn(() => ({
    webContents: {
      mainFrame: {},
      setWindowOpenHandler: jest.fn(),
      send: jest.fn(),
    },
    on: jest.fn(),
    isDestroyed: () => false,
  })),
  dialog: {
    showOpenDialog: jest.fn(),
    showMessageBox: jest.fn(),
    showErrorBox: jest.fn(),
  },
  ipcMain: { handle: jest.fn() },
  net: { fetch: jest.fn() },
  protocol: {
    registerSchemesAsPrivileged: jest.fn(),
    handle: jest.fn(),
  },
}));
jest.mock('better-sqlite3', () => jest.fn(() => ({ close: jest.fn() })));
jest.mock('../main/musicCatalog', () => {
  const actual = jest.requireActual('../main/musicCatalog');
  return {
    ...actual,
    initializeMusicCatalog: jest.fn(),
    createMusicCatalog: jest.fn(() => mockCatalog),
  };
});
jest.mock('../main/musicTagManager', () => ({
  createMusicTagManager: jest.fn(() => ({})),
}));
jest.mock('../main/musicPlayback', () => ({
  createMusicPlayback: jest.fn(() => ({})),
}));
jest.mock('../main/musicWindow', () => jest.fn().mockResolvedValue(undefined));
jest.mock('../main/musicExport');

describe('file export IPC', () => {
  let directory: string;
  let handler: Parameters<typeof ipcMain.handle>[1];
  let filterHandler: Parameters<typeof ipcMain.handle>[1];
  let createFilteredPlaylistHandler: Parameters<typeof ipcMain.handle>[1];
  let sender: WebContents;
  const request = { kind: 'playlist', id: 8 };
  const collect = jest.mocked(collectExportTracks);
  const copy = jest.mocked(copyExportTracks);

  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-export-ipc-'));
    jest.mocked(app.getPath).mockReturnValue(directory);
    jest.requireActual('../main/musicMain');
    await Promise.resolve();
    const registration = jest
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === MUSIC_CHANNELS.EXPORT_FILES);
    if (!registration) throw new Error('Export handler was not registered.');
    [, handler] = registration;
    const filterRegistration = jest
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === MUSIC_CHANNELS.FILTER_TRACKS);
    if (!filterRegistration)
      throw new Error('Track filter handler was not registered.');
    [, filterHandler] = filterRegistration;
    const createPlaylistRegistration = jest
      .mocked(ipcMain.handle)
      .mock.calls.find(
        ([channel]) => channel === MUSIC_CHANNELS.CREATE_FILTERED_PLAYLIST,
      );
    if (!createPlaylistRegistration)
      throw new Error('Filtered playlist handler was not registered.');
    [, createFilteredPlaylistHandler] = createPlaylistRegistration;
    sender = jest.mocked(BrowserWindow).mock.results[0].value.webContents;
  });

  beforeEach(() => {
    collect.mockReset().mockReturnValue([
      {
        id: 1,
        path: path.join(directory, 'song.mp3'),
        title: 'Song',
        album: '',
        duration_ms: 1000,
        rating: 7,
        status: 'present',
        metadata_incomplete: 0,
      },
    ]);
    copy
      .mockReset()
      .mockImplementation(async (_catalog, _tracks, destination, report) => {
        const result = {
          destination,
          total: 1,
          completed: 1,
          copied: 1,
          failed: 0,
          currentFile: 'song.mp3',
          errors: [],
        };
        report(result);
        return result;
      });
    jest
      .mocked(dialog.showOpenDialog)
      .mockReset()
      .mockResolvedValue({
        canceled: false,
        filePaths: [directory],
      });
    jest.mocked(dialog.showMessageBox).mockReset().mockResolvedValue({
      response: 1,
      checkboxChecked: false,
    });
    jest.mocked(sender.send).mockClear();
  });

  afterAll(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const event = (): IpcMainInvokeEvent => ({
    sender,
    senderFrame: sender.mainFrame,
    frameId: 1,
    processId: 1,
    type: 'frame',
    preventDefault: jest.fn(),
    defaultPrevented: false,
  });
  const invoke = (
    input: unknown = request,
  ): Promise<MusicResult<MusicExportResult | null>> => handler(event(), input);

  it('confirms the destination and count before copying and sends progress', async () => {
    const result = await invoke();
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        message: 'Copy 1 matching file to this directory?',
        detail: expect.stringContaining(directory),
        defaultId: 0,
        cancelId: 0,
      }),
    );
    expect(
      jest.mocked(dialog.showMessageBox).mock.invocationCallOrder[0],
    ).toBeLessThan(copy.mock.invocationCallOrder[0]);
    expect(result).toMatchObject({ ok: true, data: { copied: 1 } });
    expect(sender.send).toHaveBeenCalledWith(
      MUSIC_CHANNELS.EXPORT_PROGRESS,
      expect.objectContaining({ completed: 1 }),
    );
  });

  it('validates filtered track IPC and creates playlists through the catalog', async () => {
    const filter = {
      text: 'Ambient',
      artistIds: [1],
      artistMatch: 'any',
      requiredGenreIds: [2],
      excludedGenreIds: [],
      minRating: 7,
      maxRating: 10,
      minDurationSeconds: 60,
      maxDurationSeconds: 240,
      dad: 'any',
      mlp: 'any',
    };
    mockCatalog.filterTracks.mockReturnValue({
      total: 1,
      totalDurationMs: 90000,
      rows: [],
    });
    expect(await filterHandler(event(), filter, 40, 0)).toEqual({
      ok: true,
      data: { total: 1, totalDurationMs: 90000, rows: [] },
    });
    expect(mockCatalog.filterTracks).toHaveBeenCalledWith(filter, 40, 0);
    expect(
      await filterHandler(
        event(),
        { ...filter, minRating: 10, maxRating: 3 },
        40,
        0,
      ),
    ).toMatchObject({ ok: false, error: { message: 'Invalid track filter.' } });
    expect(await filterHandler(event(), filter, 101, 0)).toMatchObject({
      ok: false,
      error: { message: 'Invalid filtered track pagination.' },
    });

    mockCatalog.createFilteredPlaylist.mockReturnValue({ playlist: null });
    expect(
      await createFilteredPlaylistHandler(event(), {
        name: '  Filtered  ',
        filter,
      }),
    ).toEqual({ ok: true, data: { playlist: null } });
    expect(mockCatalog.createFilteredPlaylist).toHaveBeenCalledWith(
      'Filtered',
      filter,
    );
    expect(
      await createFilteredPlaylistHandler(event(), {
        name: 'Invalid',
        filter: { ...filter, extra: true },
      }),
    ).toMatchObject({ ok: false });
  });

  it('does not copy when destination selection is cancelled', async () => {
    jest
      .mocked(dialog.showOpenDialog)
      .mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await invoke()).toEqual({ ok: true, data: null });
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });

  it('does not copy when confirmation is cancelled', async () => {
    jest
      .mocked(dialog.showMessageBox)
      .mockResolvedValue({ response: 0, checkboxChecked: false });
    expect(await invoke()).toEqual({ ok: true, data: null });
    expect(copy).not.toHaveBeenCalled();
  });

  it('reports an empty list without opening a destination picker', async () => {
    collect.mockReturnValue([]);
    expect(await invoke()).toMatchObject({
      ok: false,
      error: { message: 'No matching files to export.' },
    });
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });

  it('rejects untrusted callers and invalid requests before opening dialogs', async () => {
    expect(
      await handler(
        { ...event(), sender: new BrowserWindow().webContents },
        request,
      ),
    ).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
    expect(
      await handler({ ...event(), senderFrame: null }, request),
    ).toMatchObject({
      ok: false,
      error: { code: 'UNAVAILABLE' },
    });
    await Promise.all(
      [
        null,
        { kind: 'playlist' },
        { kind: 'playlist', id: -1 },
        { kind: 'library', text: 'Dance', ratingFilter: '4-star' },
        { kind: 'artist', id: 1 },
        { kind: 'genre', id: 1 },
      ].map(async (input) => {
        expect(await invoke(input)).toMatchObject({ ok: false });
      }),
    );
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });

  it('rejects simultaneous exports and releases the lock after failure', async () => {
    let failCopy: ((cause: Error) => void) | undefined;
    copy.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failCopy = reject;
        }),
    );
    const first = invoke();
    await Promise.resolve();
    await Promise.resolve();
    expect(await invoke()).toMatchObject({
      ok: false,
      error: { message: 'An export is already running.' },
    });
    failCopy?.(new Error('Cannot write destination.'));
    expect(await first).toMatchObject({
      ok: false,
      error: { message: 'Cannot write destination.' },
    });
    expect(await invoke()).toMatchObject({ ok: true, data: { copied: 1 } });
  });
});
