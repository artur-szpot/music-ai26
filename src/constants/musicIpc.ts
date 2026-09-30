import type {
  CatalogTag,
  CompletionistPlaylistRequest,
  CompletionistPlaylistResult,
  FilteredPlaylistRequest,
  FilteredPlaylistResult,
  FilteredTrackResult,
  PlaybackState,
  PlaybackStateUpdate,
  PlaylistSummary,
  TagKind,
  TrackRatingFilter,
  TrackDetail,
  TrackFilter,
  TrackPlaylist,
  TrackSummary,
} from '../main/musicCatalog';
import type { ScanResult } from '../main/musicScanner';
import type { TagChangeResult } from '../main/musicTagManager';
import type { MusicTagEdit } from '../main/musicTags';

export const MUSIC_CHANNELS = {
  ROOTS: 'music:roots',
  CHOOSE_ROOT: 'music:choose-root',
  SCAN: 'music:scan',
  CANCEL_SCAN: 'music:cancel-scan',
  SEARCH: 'music:search',
  DETAIL: 'music:detail',
  EDIT: 'music:edit',
  TAGS: 'music:tags',
  TAG_SONGS: 'music:tag-songs',
  ADD_TAG: 'music:add-tag',
  MOVE_TAG: 'music:move-tag',
  RANDOM_TRACK: 'music:random-track',
  PLAYLISTS: 'music:playlists',
  CREATE_PLAYLIST: 'music:create-playlist',
  RENAME_PLAYLIST: 'music:rename-playlist',
  DELETE_PLAYLIST: 'music:delete-playlist',
  PLAYLIST_TRACKS: 'music:playlist-tracks',
  TRACK_PLAYLISTS: 'music:track-playlists',
  ADD_PLAYLIST_TRACK: 'music:add-playlist-track',
  REMOVE_PLAYLIST_TRACK: 'music:remove-playlist-track',
  MOVE_PLAYLIST_TRACK: 'music:move-playlist-track',
  CREATE_COMPLETIONIST_PLAYLIST: 'music:create-completionist-playlist',
  FILTER_TRACKS: 'music:filter-tracks',
  CREATE_FILTERED_PLAYLIST: 'music:create-filtered-playlist',
  PLAYBACK_STATE: 'music:playback-state',
  SAVE_PLAYBACK_STATE: 'music:save-playback-state',
  PLAYBACK_SOURCE: 'music:playback-source',
  EXPORT_FILES: 'music:export-files',
  EXPORT_PROGRESS: 'music:export-progress',
} as const;

export type MusicExportRequest = { kind: 'playlist'; id: number };

export type MusicExportProgress = {
  destination: string;
  total: number;
  completed: number;
  copied: number;
  failed: number;
  currentFile: string;
};

export type MusicExportResult = MusicExportProgress & {
  errors: { fileName: string; message: string }[];
};

export type MusicResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export type MusicBridge = {
  exportFiles(
    request: MusicExportRequest,
  ): Promise<MusicResult<MusicExportResult | null>>;
  onExportProgress(
    listener: (progress: MusicExportProgress) => void,
  ): () => void;
  playbackSource(id: number): Promise<MusicResult<{ url: string }>>;
  roots(): Promise<MusicResult<{ id: number; root_path: string }[]>>;
  chooseRoot(): Promise<MusicResult<{ id: number; root_path: string } | null>>;
  scan(rootId: number): Promise<MusicResult<ScanResult>>;
  cancelScan(): Promise<MusicResult<boolean>>;
  search(
    text: string,
    limit: number,
    offset: number,
    ratingFilter: TrackRatingFilter,
  ): Promise<
    MusicResult<{
      total: number;
      rows: TrackSummary[];
    }>
  >;
  detail(id: number): Promise<MusicResult<TrackDetail | null>>;
  edit(id: number, changes: MusicTagEdit): Promise<MusicResult<TrackDetail>>;
  tags(kind: TagKind): Promise<MusicResult<CatalogTag[]>>;
  tagSongs(
    kind: TagKind,
    id: number,
    limit: number,
    offset: number,
  ): Promise<
    MusicResult<{
      total: number;
      rows: TrackSummary[];
    }>
  >;
  addTag(
    kind: TagKind,
    name: string,
  ): Promise<MusicResult<{ id: number; name: string }>>;
  moveTag(
    kind: TagKind,
    sourceId: number,
    destinationName: string,
  ): Promise<MusicResult<TagChangeResult>>;
  randomTrack(): Promise<MusicResult<TrackSummary | null>>;
  playlists(): Promise<MusicResult<PlaylistSummary[]>>;
  createPlaylist(name: string): Promise<MusicResult<PlaylistSummary>>;
  renamePlaylist(
    id: number,
    name: string,
  ): Promise<MusicResult<PlaylistSummary>>;
  deletePlaylist(id: number): Promise<MusicResult<boolean>>;
  playlistTracks(id: number): Promise<MusicResult<TrackSummary[]>>;
  trackPlaylists(id: number): Promise<MusicResult<TrackPlaylist[]>>;
  addPlaylistTrack(
    playlistId: number,
    trackId: number,
  ): Promise<MusicResult<void>>;
  removePlaylistTrack(
    playlistId: number,
    trackId: number,
  ): Promise<MusicResult<boolean>>;
  movePlaylistTrack(
    playlistId: number,
    trackId: number,
    position: number,
  ): Promise<MusicResult<void>>;
  createCompletionistPlaylist(
    request: CompletionistPlaylistRequest,
  ): Promise<MusicResult<CompletionistPlaylistResult>>;
  filterTracks(
    filter: TrackFilter,
    limit: number,
    offset: number,
  ): Promise<MusicResult<FilteredTrackResult>>;
  createFilteredPlaylist(
    request: FilteredPlaylistRequest,
  ): Promise<MusicResult<FilteredPlaylistResult>>;
  playbackState(): Promise<MusicResult<PlaybackState>>;
  savePlaybackState(update: PlaybackStateUpdate): Promise<MusicResult<void>>;
};
