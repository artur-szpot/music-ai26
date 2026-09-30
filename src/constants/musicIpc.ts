import type { TrackDetail, TrackSummary } from '../main/musicCatalog';
import type { ScanResult } from '../main/musicScanner';
import type { MusicTagEdit } from '../main/musicTags';

export const MUSIC_CHANNELS = {
  ROOTS: 'music:roots',
  CHOOSE_ROOT: 'music:choose-root',
  SCAN: 'music:scan',
  CANCEL_SCAN: 'music:cancel-scan',
  SEARCH: 'music:search',
  DETAIL: 'music:detail',
  EDIT: 'music:edit',
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
};
