import fs from 'node:fs';
import { createMusicCatalog, TagKind, TrackDetail } from './musicCatalog';
import { MusicTagEdit, MusicTags, writeMusicTags } from './musicTags';
import resolveMusicFilePath from './musicFiles';

type Catalog = ReturnType<typeof createMusicCatalog>;

export type TagChangeResult = {
  destinationId: number;
  updated: number;
  remaining: number;
  errors: { trackId: number; message: string }[];
};

function normalizeName(name: string): string {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) {
    throw new Error('Invalid tag name.');
  }
  return name.trim();
}

function replacement(
  names: string[],
  source: string,
  target: string,
): string[] {
  const changed = names.map((name) =>
    name.toLocaleLowerCase() === source.toLocaleLowerCase() ? target : name,
  );
  return changed.filter(
    (name, index) =>
      changed.findIndex(
        (candidate) =>
          candidate.toLocaleLowerCase() === name.toLocaleLowerCase(),
      ) === index,
  );
}

export function createMusicTagManager(
  catalog: Catalog,
  writeTags: (
    filePath: string,
    changes: MusicTagEdit,
  ) => MusicTags = writeMusicTags,
) {
  const saveTrack = (id: number, changes: MusicTagEdit): TrackDetail => {
    const track = catalog.detail(id);
    if (!track || track.status !== 'present')
      throw new Error('Track is unavailable.');
    const root = catalog
      .roots()
      .find(({ id: rootId }) => rootId === track.source_id);
    if (!root) throw new Error('Source root is unavailable.');
    const actualPath = resolveMusicFilePath(track.path, root.root_path);
    const before = fs.statSync(actualPath);
    if (before.size !== track.size_bytes || before.mtimeMs !== track.mtime_ms) {
      throw new Error('Track changed on disk. Rescan before editing.');
    }
    const saved = writeTags(actualPath, changes);
    const after = fs.statSync(actualPath);
    catalog.upsertTrack({
      sourceId: track.source_id,
      filePath: track.path,
      sizeBytes: after.size,
      mtimeMs: after.mtimeMs,
      tags: saved,
    });
    return catalog.detail(id)!;
  };

  const move = (
    kind: TagKind,
    sourceId: number,
    name: string,
  ): TagChangeResult => {
    const source = catalog.tag(kind, sourceId);
    if (!source) throw new Error('Source tag not found.');
    const target = normalizeName(name);
    if (source.name.toLocaleLowerCase() === target.toLocaleLowerCase()) {
      throw new Error('Choose a different tag name.');
    }
    const existing = catalog
      .tags(kind)
      .find(
        ({ name: candidate }) =>
          candidate.toLocaleLowerCase() === target.toLocaleLowerCase(),
      );
    const ids = catalog.tagTrackIds(kind, sourceId);
    if (!ids.length && !existing) {
      catalog.renameEmptyTag(kind, sourceId, target);
      return { destinationId: sourceId, updated: 0, remaining: 0, errors: [] };
    }
    const destinationId = existing?.id ?? catalog.addTag(kind, target).id;
    const errors: TagChangeResult['errors'] = [];
    let updated = 0;
    ids.forEach((id) => {
      try {
        const detail = catalog.detail(id);
        if (!detail) throw new Error('Track not found.');
        const field = kind === 'artist' ? 'artists' : 'genres';
        saveTrack(id, {
          [field]: replacement(detail[field], source.name, target),
        });
        updated += 1;
      } catch (error) {
        errors.push({
          trackId: id,
          message:
            error instanceof Error ? error.message : 'Could not update tags.',
        });
      }
    });
    const remaining = catalog.tagSongs(kind, sourceId).total;
    if (remaining === 0) catalog.removeEmptyTag(kind, sourceId);
    return { destinationId, updated, remaining, errors };
  };

  return { saveTrack, move };
}
