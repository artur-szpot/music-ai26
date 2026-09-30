import { contextBridge, ipcRenderer } from 'electron';
import { MUSIC_CHANNELS, MusicBridge } from '../constants/musicIpc';

const musicBridge: MusicBridge = {
  roots: () => ipcRenderer.invoke(MUSIC_CHANNELS.ROOTS),
  chooseRoot: () => ipcRenderer.invoke(MUSIC_CHANNELS.CHOOSE_ROOT),
  scan: (rootId) => ipcRenderer.invoke(MUSIC_CHANNELS.SCAN, rootId),
  cancelScan: () => ipcRenderer.invoke(MUSIC_CHANNELS.CANCEL_SCAN),
  search: (text, limit, offset) =>
    ipcRenderer.invoke(MUSIC_CHANNELS.SEARCH, text, limit, offset),
  detail: (id) => ipcRenderer.invoke(MUSIC_CHANNELS.DETAIL, id),
  edit: (id, changes) => ipcRenderer.invoke(MUSIC_CHANNELS.EDIT, id, changes),
};

contextBridge.exposeInMainWorld('music', musicBridge);

declare global {
  interface Window {
    music: MusicBridge;
  }
}
