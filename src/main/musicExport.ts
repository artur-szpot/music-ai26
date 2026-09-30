import fs from 'node:fs';
import path from 'node:path';
import type {
  MusicExportRequest,
  MusicExportProgress,
  MusicExportResult,
} from '../constants/musicIpc';
import type { createMusicCatalog, TrackSummary } from './musicCatalog';
import resolveMusicFilePath from './musicFiles';

type ExportCatalog = Pick<
  ReturnType<typeof createMusicCatalog>,
  'playlistTracks' | 'detail' | 'roots'
>;

export function collectExportTracks(
  catalog: ExportCatalog,
  request: MusicExportRequest,
): TrackSummary[] {
  return catalog.playlistTracks(request.id);
}

async function copyWithoutReplacing(
  source: string,
  destination: string,
  fileName: string,
  suffix = 1,
): Promise<void> {
  const { name, ext } = path.parse(fileName);
  const target = path.join(
    destination,
    suffix === 1 ? fileName : `${name} (${suffix})${ext}`,
  );
  try {
    await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  } catch (cause) {
    if (
      cause !== null &&
      typeof cause === 'object' &&
      'code' in cause &&
      cause.code === 'EEXIST'
    ) {
      return copyWithoutReplacing(source, destination, fileName, suffix + 1);
    }
    throw cause;
  }
  return undefined;
}

export async function copyExportTracks(
  catalog: ExportCatalog,
  tracks: TrackSummary[],
  destinationPath: string,
  onProgress: (progress: MusicExportProgress) => void,
): Promise<MusicExportResult> {
  const destination = await fs.promises.realpath(destinationPath);
  if (!(await fs.promises.stat(destination)).isDirectory())
    throw new Error('Export destination is not a directory.');
  const roots = catalog.roots();
  const result: MusicExportResult = {
    destination,
    total: tracks.length,
    completed: 0,
    copied: 0,
    failed: 0,
    currentFile: '',
    errors: [],
  };
  const report = () => {
    onProgress({
      destination: result.destination,
      total: result.total,
      completed: result.completed,
      copied: result.copied,
      failed: result.failed,
      currentFile: result.currentFile,
    });
  };
  report();
  await tracks.reduce(async (previous, track) => {
    await previous;
    result.currentFile = path.basename(track.path);
    report();
    try {
      const detail = catalog.detail(track.id);
      if (!detail || detail.status !== 'present')
        throw new Error('Track is unavailable.');
      const root = roots.find(({ id }) => id === detail.source_id);
      if (!root) throw new Error('Source root is unavailable.');
      const source = resolveMusicFilePath(
        detail.path,
        fs.realpathSync(root.root_path),
      );
      if (
        !['.mp3', '.flac', '.m4a'].includes(
          path.extname(source).toLowerCase(),
        ) ||
        !(await fs.promises.stat(source)).isFile()
      ) {
        throw new Error('Track is not a supported audio file.');
      }
      if ((await fs.promises.realpath(destinationPath)) !== destination)
        throw new Error('Export destination changed. Choose it again.');
      await copyWithoutReplacing(
        source,
        destination,
        path.basename(detail.path),
      );
      result.copied += 1;
    } catch (cause) {
      result.failed += 1;
      result.errors.push({
        fileName: track.path,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
    result.completed += 1;
    report();
  }, Promise.resolve());
  return result;
}
