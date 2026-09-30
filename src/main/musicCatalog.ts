import path from 'node:path';
import type Database from 'better-sqlite3';
import type { MusicTags } from './musicTags';

type CatalogDatabase = Pick<Database.Database, 'exec' | 'prepare'>;

export type ScannedTrack = {
  sourceId: number;
  filePath: string;
  sizeBytes: number;
  mtimeMs: number;
  tags: MusicTags;
};

export type TrackSummary = {
  id: number;
  path: string;
  title: string;
  album: string;
  duration_ms: number;
  status: 'present' | 'missing';
};

export type TrackDetail = TrackSummary & {
  source_id: number;
  size_bytes: number;
  mtime_ms: number;
  year: number;
  track_number: number;
  artists: string[];
  genres: string[];
};

export function initializeMusicCatalog(
  database: CatalogDatabase,
  schema: string,
): void {
  const version = database.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  if (version.user_version === 0) {
    const existingTables = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1")
      .get();
    if (existingTables) throw new Error('The selected database is not empty.');
    database.exec(schema);
  } else if (version.user_version !== 1) {
    throw new Error('Unsupported music catalog version.');
  }

  const musicTable = database
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tracks'",
    )
    .get();
  if (!musicTable) throw new Error('This is not a music catalog.');
  database.exec('PRAGMA foreign_keys = ON');
}

export function createMusicCatalog(database: CatalogDatabase) {
  const getSource = database.prepare(
    'SELECT root_path FROM sources WHERE id = ?',
  );
  const getSources = database.prepare(
    'SELECT id, root_path FROM sources ORDER BY id',
  );
  const addSource = database.prepare(
    'INSERT INTO sources (root_path) VALUES (?) ON CONFLICT(root_path) DO NOTHING',
  );
  const sourceId = database.prepare(
    'SELECT id FROM sources WHERE root_path = ?',
  );
  const saveTrack = database.prepare(`
    INSERT INTO tracks (
      source_id, path, format, size_bytes, mtime_ms, title, album,
      duration_ms, year, track_number, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'present')
    ON CONFLICT(path) DO UPDATE SET
      source_id = excluded.source_id, format = excluded.format,
      size_bytes = excluded.size_bytes, mtime_ms = excluded.mtime_ms,
      title = excluded.title, album = excluded.album,
      duration_ms = excluded.duration_ms, year = excluded.year,
      track_number = excluded.track_number, status = 'present',
      last_seen_at = CURRENT_TIMESTAMP
  `);
  const trackId = database.prepare('SELECT id FROM tracks WHERE path = ?');
  const getTrack = database.prepare('SELECT * FROM tracks WHERE id = ?');
  const getArtists = database.prepare(`
    SELECT a.name FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
    WHERE ta.track_id = ? ORDER BY ta.position
  `);
  const getGenres = database.prepare(`
    SELECT g.name FROM track_genres tg JOIN genres g ON g.id = tg.genre_id
    WHERE tg.track_id = ? ORDER BY g.name COLLATE NOCASE
  `);
  const clearArtists = database.prepare(
    'DELETE FROM track_artists WHERE track_id = ?',
  );
  const clearGenres = database.prepare(
    'DELETE FROM track_genres WHERE track_id = ?',
  );
  const addArtist = database.prepare(
    'INSERT INTO artists (name) VALUES (?) ON CONFLICT(name) DO NOTHING',
  );
  const artistId = database.prepare('SELECT id FROM artists WHERE name = ?');
  const linkArtist = database.prepare(
    'INSERT INTO track_artists (track_id, artist_id, position) VALUES (?, ?, ?)',
  );
  const addGenre = database.prepare(
    'INSERT INTO genres (name) VALUES (?) ON CONFLICT(name) DO NOTHING',
  );
  const genreId = database.prepare('SELECT id FROM genres WHERE name = ?');
  const linkGenre = database.prepare(
    'INSERT OR IGNORE INTO track_genres (track_id, genre_id) VALUES (?, ?)',
  );
  const knownPaths = database.prepare(
    'SELECT path FROM tracks WHERE source_id = ?',
  );
  const existingTrack = database.prepare(
    'SELECT size_bytes, mtime_ms, status FROM tracks WHERE source_id = ? AND path = ?',
  );
  const markMissing = database.prepare(
    "UPDATE tracks SET status = 'missing' WHERE source_id = ? AND path = ?",
  );
  const searchWhere = `
    WHERE (? = '' OR tracks.title LIKE ? ESCAPE '\\'
      OR tracks.album LIKE ? ESCAPE '\\'
      OR tracks.path LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
        WHERE ta.track_id = tracks.id AND a.name LIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM track_genres tg JOIN genres g ON g.id = tg.genre_id
        WHERE tg.track_id = tracks.id AND g.name LIKE ? ESCAPE '\\'))
  `;
  const searchCount = database.prepare(
    `SELECT count(*) AS total FROM tracks ${searchWhere}`,
  );
  const searchRows = database.prepare(`
    SELECT tracks.id, tracks.path, tracks.title, tracks.album,
      tracks.duration_ms, tracks.status FROM tracks ${searchWhere}
    ORDER BY tracks.title COLLATE NOCASE, tracks.id LIMIT ? OFFSET ?
  `);

  return {
    roots(): { id: number; root_path: string }[] {
      return getSources.all() as { id: number; root_path: string }[];
    },
    detail(id: number): TrackDetail | undefined {
      const track = getTrack.get(id) as
        | Omit<TrackDetail, 'artists' | 'genres'>
        | undefined;
      if (!track) return undefined;
      return {
        ...track,
        artists: (getArtists.all(id) as { name: string }[]).map(
          ({ name }) => name,
        ),
        genres: (getGenres.all(id) as { name: string }[]).map(
          ({ name }) => name,
        ),
      };
    },
    addRoot(rootPath: string): number {
      if (!path.isAbsolute(rootPath))
        throw new Error('Source root must be absolute.');
      const normalized = path.resolve(rootPath);
      addSource.run(normalized);
      return (sourceId.get(normalized) as { id: number }).id;
    },
    upsertTrack({
      sourceId: rootId,
      filePath,
      sizeBytes,
      mtimeMs,
      tags,
    }: ScannedTrack): number {
      const source = getSource.get(rootId) as { root_path: string } | undefined;
      if (!source) throw new Error('Unknown source root.');
      const normalized = path.resolve(filePath);
      const relative = path.relative(source.root_path, normalized);
      if (
        !relative ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        throw new Error('Track must be inside its source root.');
      }
      const format = path.extname(normalized).slice(1).toLowerCase();
      if (!['mp3', 'flac', 'm4a'].includes(format)) {
        throw new Error('Unsupported audio format.');
      }
      database.exec('BEGIN IMMEDIATE');
      try {
        saveTrack.run(
          rootId,
          normalized,
          format,
          sizeBytes,
          mtimeMs,
          tags.title,
          tags.album,
          tags.durationMs,
          tags.year,
          tags.track,
        );
        const { id } = trackId.get(normalized) as { id: number };
        clearArtists.run(id);
        clearGenres.run(id);
        tags.artists.forEach((name, position) => {
          addArtist.run(name);
          linkArtist.run(
            id,
            (artistId.get(name) as { id: number }).id,
            position,
          );
        });
        tags.genres.forEach((name) => {
          addGenre.run(name);
          linkGenre.run(id, (genreId.get(name) as { id: number }).id);
        });
        database.exec('COMMIT');
        return id;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    markAbsent(rootId: number, seenPaths: ReadonlySet<string>): number {
      let missing = 0;
      (knownPaths.all(rootId) as { path: string }[]).forEach(
        ({ path: filePath }) => {
          if (!seenPaths.has(filePath)) {
            markMissing.run(rootId, filePath);
            missing += 1;
          }
        },
      );
      return missing;
    },
    needsScan(
      rootId: number,
      filePath: string,
      sizeBytes: number,
      mtimeMs: number,
    ): boolean {
      const row = existingTrack.get(rootId, filePath) as
        | {
            size_bytes: number;
            mtime_ms: number;
            status: string;
          }
        | undefined;
      return (
        !row ||
        row.size_bytes !== sizeBytes ||
        row.mtime_ms !== mtimeMs ||
        row.status !== 'present'
      );
    },
    search(
      text: string,
      limit = 50,
      offset = 0,
    ): { total: number; rows: TrackSummary[] } {
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        text.length > 200
      ) {
        throw new Error('Invalid search pagination or query.');
      }
      const escaped = `%${text.replace(/[\\%_]/g, '\\$&')}%`;
      const params = [text, escaped, escaped, escaped, escaped, escaped];
      return {
        total: (searchCount.get(...params) as { total: number }).total,
        rows: searchRows.all(...params, limit, offset) as TrackSummary[],
      };
    },
  };
}
