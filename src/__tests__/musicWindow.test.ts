/** @jest-environment node */
import { EventEmitter } from 'node:events';
import loadMusicWindow, { MusicWindow } from '../main/musicWindow';

describe('music window startup navigation', () => {
  const url = 'http://localhost:60606/index.html';
  let events: EventEmitter;
  let window: MusicWindow;
  let loadURL: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    events = new EventEmitter();
    loadURL = jest.fn();
    window = {
      loadURL,
      webContents: Object.assign(events, { getURL: () => url }),
    };
    jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('accepts an ordinary successful initial navigation', async () => {
    loadURL.mockResolvedValue(undefined);
    await loadMusicWindow(window, url);
    expect(loadURL).toHaveBeenCalledWith(url);
    expect(events.listenerCount('did-finish-load')).toBe(0);
  });

  it('waits for a superseding reload after ERR_ABORTED', async () => {
    loadURL.mockRejectedValue(
      Object.assign(new Error('ERR_ABORTED'), { code: 'ERR_ABORTED' }),
    );
    const loaded = loadMusicWindow(window, url);
    await Promise.resolve();
    await Promise.resolve();
    events.emit('did-fail-load', {}, -3, 'ERR_ABORTED', url, true);
    expect(events.listenerCount('did-finish-load')).toBe(1);
    events.emit('did-finish-load');
    await loaded;
    expect(process.stderr.write).toHaveBeenCalled();
    expect(events.listenerCount('did-finish-load')).toBe(0);
  });

  it('does not suppress a real navigation failure', async () => {
    loadURL.mockRejectedValue(new Error('ERR_CONNECTION_REFUSED'));
    await expect(loadMusicWindow(window, url)).rejects.toThrow(
      'ERR_CONNECTION_REFUSED',
    );
    expect(events.listenerCount('did-fail-load')).toBe(0);
  });

  it('reports a failed reload after an aborted initial navigation', async () => {
    loadURL.mockRejectedValue(
      Object.assign(new Error('ERR_ABORTED'), { code: 'ERR_ABORTED' }),
    );
    const loaded = loadMusicWindow(window, url);
    const rejected = loaded.catch((error: Error) => error);
    await Promise.resolve();
    events.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', url, true);
    expect(await rejected).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('ERR_CONNECTION_REFUSED (-102)'),
      }),
    );
  });

  it('times out rather than pretending an aborted navigation succeeded', async () => {
    loadURL.mockRejectedValue(
      Object.assign(new Error('ERR_ABORTED'), { code: 'ERR_ABORTED' }),
    );
    const loaded = loadMusicWindow(window, url);
    const rejected = loaded.catch((error: Error) => error);
    await Promise.resolve();
    jest.advanceTimersByTime(30000);
    expect(await rejected).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Timed out loading'),
      }),
    );
    expect(events.listenerCount('did-finish-load')).toBe(0);
  });
});
