import { contextBridge, ipcRenderer } from 'electron';
import { MUSIC_CHANNELS, MusicBridge } from '../constants/musicIpc';

const musicBridge: MusicBridge = {
  playbackSource: (id) =>
    ipcRenderer.invoke(MUSIC_CHANNELS.PLAYBACK_SOURCE, id),
  roots: () => ipcRenderer.invoke(MUSIC_CHANNELS.ROOTS),
  chooseRoot: () => ipcRenderer.invoke(MUSIC_CHANNELS.CHOOSE_ROOT),
  scan: (rootId) => ipcRenderer.invoke(MUSIC_CHANNELS.SCAN, rootId),
  cancelScan: () => ipcRenderer.invoke(MUSIC_CHANNELS.CANCEL_SCAN),
  search: (text, limit, offset) =>
    ipcRenderer.invoke(MUSIC_CHANNELS.SEARCH, text, limit, offset),
  detail: (id) => ipcRenderer.invoke(MUSIC_CHANNELS.DETAIL, id),
  edit: (id, changes) => ipcRenderer.invoke(MUSIC_CHANNELS.EDIT, id, changes),
  tags: (kind) => ipcRenderer.invoke(MUSIC_CHANNELS.TAGS, kind),
  tagSongs: (kind, id, limit, offset) =>
    ipcRenderer.invoke(MUSIC_CHANNELS.TAG_SONGS, kind, id, limit, offset),
  addTag: (kind, name) =>
    ipcRenderer.invoke(MUSIC_CHANNELS.ADD_TAG, kind, name),
  moveTag: (kind, sourceId, destinationName) =>
    ipcRenderer.invoke(
      MUSIC_CHANNELS.MOVE_TAG,
      kind,
      sourceId,
      destinationName,
    ),
};

contextBridge.exposeInMainWorld('music', musicBridge);

declare global {
  interface Window {
    music: MusicBridge;
  }
}
