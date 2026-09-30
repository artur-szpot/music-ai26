import type { BrowserWindow, Event as ElectronEvent } from 'electron';
import type { EventEmitter } from 'node:events';

export type MusicWindow = {
  loadURL: BrowserWindow['loadURL'];
  webContents: Pick<EventEmitter, 'on' | 'removeListener'> &
    Pick<BrowserWindow['webContents'], 'getURL'>;
};

export default function loadMusicWindow(
  window: MusicWindow,
  url: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { webContents } = window;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    let cleanup: () => void;
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      if (error) reject(error);
      else resolve();
    }
    function loaded() {
      if (webContents.getURL() === url) finish();
    }
    function failed(
      _event: ElectronEvent,
      code: number,
      description: string,
      failedUrl: string,
      mainFrame: boolean,
    ) {
      if (mainFrame && code !== -3) {
        finish(new Error(`${description} (${code}) loading '${failedUrl}'`));
      }
    }
    function destroyed() {
      finish(new Error('Music window closed before loading.'));
    }
    cleanup = () => {
      webContents.removeListener('did-finish-load', loaded);
      webContents.removeListener('did-fail-load', failed);
      webContents.removeListener('destroyed', destroyed);
    };
    timeout = setTimeout(() => {
      finish(
        new Error(
          `Timed out loading '${url}'. Check that the renderer server is running.`,
        ),
      );
    }, 30000);
    webContents.on('did-finish-load', loaded);
    webContents.on('did-fail-load', failed);
    webContents.on('destroyed', destroyed);
    window
      .loadURL(url)
      .then(() => finish())
      .catch((error: unknown) => {
        if (settled) return;
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ERR_ABORTED'
        ) {
          // A development reload can supersede loadURL; require that navigation to finish.
          process.stderr.write(
            `Music window load interrupted; waiting for reload: ${error.message}\n`,
          );
        } else {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
  });
}
