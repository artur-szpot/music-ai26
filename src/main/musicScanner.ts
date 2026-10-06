import { promises as fs } from 'node:fs';
import path from 'node:path';
import { setImmediate } from 'node:timers';
import { createMusicCatalog } from './musicCatalog';
import { readMusicTags } from './musicTags';

export type ScanResult = {
  addedOrUpdated: number;
  unchanged: number;
  failed: number;
  missing: number;
  cancelled: boolean;
  errors: { fileName: string; message: string }[];
};

const formats = new Set(['.mp3', '.flac', '.m4a']);

export async function scanMusicRoot(
  catalog: ReturnType<typeof createMusicCatalog>,
  rootPath: string,
  signal?: AbortSignal,
  rereadTags = false,
): Promise<ScanResult> {
  const root = await fs.realpath(rootPath);
  if (!(await fs.stat(root)).isDirectory()) {
    throw new Error('Music root must be a directory.');
  }
  const sourceId = catalog.addRoot(root);
  const seen = new Set<string>();
  const result: ScanResult = {
    addedOrUpdated: 0,
    unchanged: 0,
    failed: 0,
    missing: 0,
    cancelled: false,
    errors: [],
  };
  let complete = true;

  const visit = async (directory: string): Promise<void> => {
    if (signal?.aborted) {
      result.cancelled = true;
      return;
    }
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      await entries.reduce(async (previous, entry) => {
        await previous;
        if (signal?.aborted) {
          result.cancelled = true;
          return;
        }
        if (entry.isSymbolicLink()) return;
        const filePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(filePath);
        } else if (
          entry.isFile() &&
          formats.has(path.extname(entry.name).toLowerCase())
        ) {
          try {
            const resolved = await fs.realpath(filePath);
            const relative = path.relative(root, resolved);
            if (
              !relative ||
              relative === '..' ||
              relative.startsWith(`..${path.sep}`) ||
              path.isAbsolute(relative)
            ) {
              throw new Error('Audio file is outside its source root.');
            }
            seen.add(resolved);
            const stats = await fs.stat(filePath);
            if (
              !rereadTags &&
              !catalog.needsScan(sourceId, resolved, stats.size, stats.mtimeMs)
            ) {
              result.unchanged += 1;
              return;
            }
            await new Promise<void>((resolve) => {
              setImmediate(resolve);
            });
            const tags = readMusicTags(resolved);
            catalog.upsertTrack({
              sourceId,
              filePath: resolved,
              sizeBytes: stats.size,
              mtimeMs: stats.mtimeMs,
              tags,
            });
            result.addedOrUpdated += 1;
          } catch (error) {
            result.failed += 1;
            result.errors.push({
              fileName: entry.name,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }, Promise.resolve());
    } catch (error) {
      complete = false;
      result.failed += 1;
      result.errors.push({
        fileName: path.basename(directory),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  await visit(root);

  if (complete && !result.cancelled) {
    result.missing = catalog.markAbsent(sourceId, seen);
  }
  return result;
}
