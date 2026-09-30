import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { MUSIC_CHANNELS, MusicBridge } from '../constants/musicIpc';

const musicBridge: MusicBridge = {
  exportFiles: (request) =>
    ipcRenderer.invoke(MUSIC_CHANNELS.EXPORT_FILES, request),
  onExportProgress: (listener) => {
    const receive = (
      _event: IpcRendererEvent,
      progress: Parameters<typeof listener>[0],
    ) => listener(progress);
    ipcRenderer.on(MUSIC_CHANNELS.EXPORT_PROGRESS, receive);
    return () =>
      ipcRenderer.removeListener(MUSIC_CHANNELS.EXPORT_PROGRESS, receive);
  },
  playbackSource: (id) =>
    ipcRenderer.invoke(MUSIC_CHANNELS.PLAYBACK_SOURCE, id),
  roots: () => ipcRenderer.invoke(MUSIC_CHANNELS.ROOTS),
  chooseRoot: () => ipcRenderer.invoke(MUSIC_CHANNELS.CHOOSE_ROOT),
  scan: (rootId) => ipcRenderer.invoke(MUSIC_CHANNELS.SCAN, rootId),
  cancelScan: () => ipcRenderer.invoke(MUSIC_CHANNELS.CANCEL_SCAN),
  search: (text, limit, offset, ratingFilter) =>
    ipcRenderer.invoke(
      MUSIC_CHANNELS.SEARCH,
      text,
      limit,
      offset,
      ratingFilter,
    ),
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
  randomTrack: () => ipcRenderer.invoke(MUSIC_CHANNELS.RANDOM_TRACK),
  playlists: () => ipcRenderer.invoke(MUSIC_CHANNELS.PLAYLISTS),
  createPlaylist: (name) =>
    ipcRenderer.invoke(MUSIC_CHANNELS.CREATE_PLAYLIST, name),
  renamePlaylist: (id, name) =>
    ipcRenderer.invoke(MUSIC_CHANNELS.RENAME_PLAYLIST, id, name),
  deletePlaylist: (id) =>
    ipcRenderer.invoke(MUSIC_CHANNELS.DELETE_PLAYLIST, id),
  playlistTracks: (id) =>
    ipcRenderer.invoke(MUSIC_CHANNELS.PLAYLIST_TRACKS, id),
  trackPlaylists: (id) =>
    ipcRenderer.invoke(MUSIC_CHANNELS.TRACK_PLAYLISTS, id),
  addPlaylistTrack: (playlistId, trackId) =>
    ipcRenderer.invoke(MUSIC_CHANNELS.ADD_PLAYLIST_TRACK, playlistId, trackId),
  removePlaylistTrack: (playlistId, trackId) =>
    ipcRenderer.invoke(
      MUSIC_CHANNELS.REMOVE_PLAYLIST_TRACK,
      playlistId,
      trackId,
    ),
  movePlaylistTrack: (playlistId, trackId, position) =>
    ipcRenderer.invoke(
      MUSIC_CHANNELS.MOVE_PLAYLIST_TRACK,
      playlistId,
      trackId,
      position,
    ),
  createCompletionistPlaylist: (request) =>
    ipcRenderer.invoke(MUSIC_CHANNELS.CREATE_COMPLETIONIST_PLAYLIST, request),
  filterTracks: (filter, limit, offset) =>
    ipcRenderer.invoke(MUSIC_CHANNELS.FILTER_TRACKS, filter, limit, offset),
  createFilteredPlaylist: (request) =>
    ipcRenderer.invoke(MUSIC_CHANNELS.CREATE_FILTERED_PLAYLIST, request),
  playbackState: () => ipcRenderer.invoke(MUSIC_CHANNELS.PLAYBACK_STATE),
  savePlaybackState: (update) =>
    ipcRenderer.invoke(MUSIC_CHANNELS.SAVE_PLAYBACK_STATE, update),
};

contextBridge.exposeInMainWorld('music', musicBridge);

declare global {
  interface Window {
    music: MusicBridge;
  }
}
