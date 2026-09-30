import type {
  CatalogTag,
  TagKind,
  TrackDetail,
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
} as const;

export type MusicResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export type MusicBridge = {
  roots(): Promise<MusicResult<{ id: number; root_path: string }[]>>;
  chooseRoot(): Promise<MusicResult<{ id: number; root_path: string } | null>>;
  scan(rootId: number): Promise<MusicResult<ScanResult>>;
  cancelScan(): Promise<MusicResult<boolean>>;
  search(
    text: string,
    limit: number,
    offset: number,
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
};
