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
  metadata_incomplete: 0 | 1;
  rating: number | null;
};

export type TrackDetail = TrackSummary & {
  source_id: number;
  size_bytes: number;
  mtime_ms: number;
  year: number;
  track_number: number;
  artists: string[];
  genres: string[];
  is_dad: 0 | 1 | null;
  is_mlp: 0 | 1 | null;
};

export type TagKind = 'artist' | 'genre';

export type TrackRatingFilter =
  | 'all'
  | '5-star'
  | '4-star'
  | '3-star'
  | 'lower';

export type TrackFlagFilter = 'any' | 'yes' | 'no';

export type TrackFilter = {
  text: string;
  artistIds: number[];
  artistMatch: 'any' | 'all';
  requiredGenreIds: number[];
  excludedGenreIds: number[];
  minRating: number | null;
  maxRating: number | null;
  minDurationSeconds: number | null;
  maxDurationSeconds: number | null;
  dad: TrackFlagFilter;
  mlp: TrackFlagFilter;
};

export type FilteredTrackResult = {
  total: number;
  totalDurationMs: number;
  rows: TrackSummary[];
};

export type FilteredPlaylistRequest = {
  name: string;
  filter: TrackFilter;
};

export type CatalogTag = {
  id: number;
  name: string;
  track_count: number;
};

export type PlaylistSummary = {
  id: number;
  name: string;
  track_count: number;
  total_duration_ms: number;
  average_rating: number | null;
};

export type TrackPlaylist = Pick<PlaylistSummary, 'id' | 'name'>;

export type CompletionistPlaylistRequest = {
  name: string;
  ratingFilter: TrackRatingFilter;
  requiredGenreIds: number[];
  excludedGenreIds: number[];
  targetMinutes: number;
};

export type CompletionistPlaylistResult = {
  playlist: PlaylistSummary | null;
  tracks: TrackSummary[];
  historyReset: boolean;
};

export type FilteredPlaylistResult = {
  playlist: PlaylistSummary | null;
};

export type PlaybackState = {
  track: TrackSummary | null;
  positionSeconds: number;
  volume: number;
};

export type PlaybackStateUpdate = {
  trackId: number | null;
  positionSeconds: number;
  volume: number;
};

const ratingRanges: Record<TrackRatingFilter, [number, number] | null> = {
  '5-star': [9, 10],
  '4-star': [7, 8],
  '3-star': [5, 6],
  lower: [0, 4],
  all: null,
};

function validFilterIds(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((id) => Number.isSafeInteger(id) && id > 0) &&
    new Set(value).size === value.length
  );
}

function validRatingBound(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= 10)
  );
}

function validFlagFilter(value: unknown): value is TrackFlagFilter {
  return value === 'any' || value === 'yes' || value === 'no';
}

function validDurationBound(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER / 1000)
  );
}

export function validateTrackFilter(input: unknown): TrackFilter {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid track filter.');
  const filter = input as Record<string, unknown>;
  const allowedKeys = new Set([
    'text',
    'artistIds',
    'artistMatch',
    'requiredGenreIds',
    'excludedGenreIds',
    'minRating',
    'maxRating',
    'minDurationSeconds',
    'maxDurationSeconds',
    'dad',
    'mlp',
  ]);
  if (
    Object.keys(filter).some((key) => !allowedKeys.has(key)) ||
    typeof filter.text !== 'string' ||
    filter.text.length > 200 ||
    !validFilterIds(filter.artistIds) ||
    (filter.artistMatch !== 'any' && filter.artistMatch !== 'all') ||
    !validFilterIds(filter.requiredGenreIds) ||
    !validFilterIds(filter.excludedGenreIds) ||
    !validRatingBound(filter.minRating) ||
    !validRatingBound(filter.maxRating) ||
    !validDurationBound(filter.minDurationSeconds) ||
    !validDurationBound(filter.maxDurationSeconds) ||
    !validFlagFilter(filter.dad) ||
    !validFlagFilter(filter.mlp) ||
    (filter.minRating !== null &&
      filter.maxRating !== null &&
      filter.minRating > filter.maxRating) ||
    (filter.minDurationSeconds !== null &&
      filter.maxDurationSeconds !== null &&
      filter.minDurationSeconds > filter.maxDurationSeconds)
  ) {
    throw new Error('Invalid track filter.');
  }
  return {
    text: filter.text,
    artistIds: filter.artistIds,
    artistMatch: filter.artistMatch,
    requiredGenreIds: filter.requiredGenreIds,
    excludedGenreIds: filter.excludedGenreIds,
    minRating: filter.minRating,
    maxRating: filter.maxRating,
    minDurationSeconds: filter.minDurationSeconds,
    maxDurationSeconds: filter.maxDurationSeconds,
    dad: filter.dad,
    mlp: filter.mlp,
  };
}

const incompleteMetadata = `
  (length(trim(tracks.title, char(9) || char(10) || char(13) || ' ')) = 0
    OR tracks.rating IS NULL
    OR NOT EXISTS (SELECT 1 FROM track_artists WHERE track_id = tracks.id)
    OR NOT EXISTS (SELECT 1 FROM track_genres WHERE track_id = tracks.id))
  AS metadata_incomplete
`;

export function initializeMusicCatalog(
  database: CatalogDatabase,
  schema: string,
): void {
  let version = database.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  if (version.user_version === 0) {
    const existingTables = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1")
      .get();
    if (existingTables) throw new Error('The selected database is not empty.');
    database.exec(schema);
    version = database.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
  } else if (![1, 2, 3, 4, 5, 6, 7].includes(version.user_version)) {
    throw new Error('Unsupported music catalog version.');
  }

  const musicTable = database
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tracks'",
    )
    .get();
  if (!musicTable) throw new Error('This is not a music catalog.');
  if (version.user_version === 1) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`
        ALTER TABLE tracks ADD COLUMN rating INTEGER
          CHECK (rating IS NULL OR rating BETWEEN 0 AND 10);
        PRAGMA user_version = 2;
      `);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    version = { user_version: 2 };
  }
  if (version.user_version === 2) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`
        CREATE TABLE artist_aliases (
          variant_name TEXT NOT NULL COLLATE NOCASE PRIMARY KEY
            CHECK (length(trim(variant_name)) > 0),
          artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE
        );
        CREATE INDEX artist_aliases_artist ON artist_aliases(artist_id);
        PRAGMA user_version = 3;
      `);
      database.exec('COMMIT');
      version = { user_version: 3 };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  if (version.user_version === 3) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`
        CREATE TABLE playlists (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE
            CHECK (length(trim(name)) BETWEEN 1 AND 200),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE playlist_tracks (
          playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
          track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
          position INTEGER NOT NULL CHECK (position >= 0),
          PRIMARY KEY (playlist_id, track_id),
          UNIQUE (playlist_id, position)
        );

        CREATE INDEX playlist_tracks_track ON playlist_tracks(track_id);
        PRAGMA user_version = 4;
      `);
      database.exec('COMMIT');
      version = { user_version: 4 };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  if (version.user_version === 4) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`
        CREATE TABLE playlist_history (
          track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
          selected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        PRAGMA user_version = 5;
      `);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    version = { user_version: 5 };
  }
  if (version.user_version === 5) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`
        CREATE TABLE playback_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          track_id INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
          position_seconds REAL NOT NULL CHECK (position_seconds >= 0),
          volume REAL NOT NULL CHECK (volume BETWEEN 0 AND 1)
        );
        INSERT INTO playback_state (id, track_id, position_seconds, volume)
          VALUES (1, NULL, 0, 1);
        PRAGMA user_version = 6;
      `);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    version = { user_version: 6 };
  }
  if (version.user_version === 6) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`
        ALTER TABLE tracks ADD COLUMN is_dad INTEGER
          CHECK (is_dad IS NULL OR is_dad IN (0, 1));
        ALTER TABLE tracks ADD COLUMN is_mlp INTEGER
          CHECK (is_mlp IS NULL OR is_mlp IN (0, 1));
        PRAGMA user_version = 7;
      `);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
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
      duration_ms, year, track_number, rating, is_dad, is_mlp, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'present')
    ON CONFLICT(path) DO UPDATE SET
      source_id = excluded.source_id, format = excluded.format,
      size_bytes = excluded.size_bytes, mtime_ms = excluded.mtime_ms,
      title = excluded.title, album = excluded.album,
      duration_ms = excluded.duration_ms, year = excluded.year,
      track_number = excluded.track_number, rating = excluded.rating,
      is_dad = excluded.is_dad, is_mlp = excluded.is_mlp,
      status = 'present',
      last_seen_at = CURRENT_TIMESTAMP
  `);
  const trackId = database.prepare('SELECT id FROM tracks WHERE path = ?');
  const getTrack = database.prepare(
    `SELECT *, ${incompleteMetadata} FROM tracks WHERE id = ?`,
  );
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
  const resolveArtistAlias = database.prepare(`
    SELECT artists.name FROM artist_aliases
    JOIN artists ON artists.id = artist_aliases.artist_id
    WHERE artist_aliases.variant_name = ?
  `);
  const saveArtistAlias = database.prepare(`
    INSERT INTO artist_aliases (variant_name, artist_id) VALUES (?, ?)
    ON CONFLICT(variant_name) DO UPDATE SET artist_id = excluded.artist_id
  `);
  const moveArtistAliases = database.prepare(
    'UPDATE artist_aliases SET artist_id = ? WHERE artist_id = ?',
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
      AND (? IS NULL OR tracks.rating BETWEEN ? AND ?)
  `;
  const searchCount = database.prepare(
    `SELECT count(*) AS total FROM tracks ${searchWhere}`,
  );
  const searchRows = database.prepare(`
    SELECT tracks.id, tracks.path, tracks.title, tracks.album,
      tracks.duration_ms, tracks.status, tracks.rating, ${incompleteMetadata}
    FROM tracks ${searchWhere}
    ORDER BY tracks.title COLLATE NOCASE, tracks.id LIMIT ? OFFSET ?
  `);
  const randomTrack = database.prepare(`
    SELECT tracks.id, tracks.path, tracks.title, tracks.album,
      tracks.duration_ms, tracks.status, tracks.rating, ${incompleteMetadata}
    FROM tracks
    WHERE tracks.status = 'present'
    ORDER BY RANDOM()
    LIMIT 1
  `);
  const readPlaybackState = database.prepare(`
    SELECT playback_state.track_id, playback_state.position_seconds,
      playback_state.volume, tracks.id, tracks.path, tracks.title,
      tracks.album, tracks.duration_ms, tracks.status, tracks.rating,
      ${incompleteMetadata}
    FROM playback_state
    LEFT JOIN tracks ON tracks.id = playback_state.track_id
    WHERE playback_state.id = 1
  `);
  const writePlaybackState = database.prepare(`
    UPDATE playback_state
    SET track_id = coalesce(?, track_id),
      position_seconds = CASE WHEN ? IS NULL
        THEN position_seconds ELSE ? END,
      volume = ?
    WHERE id = 1
  `);
  const playlistSummarySql = `
    SELECT playlists.id, playlists.name,
      count(playlist_tracks.track_id) AS track_count,
      coalesce(sum(tracks.duration_ms), 0) AS total_duration_ms,
      avg(tracks.rating) AS average_rating
    FROM playlists
    LEFT JOIN playlist_tracks ON playlist_tracks.playlist_id = playlists.id
    LEFT JOIN tracks ON tracks.id = playlist_tracks.track_id
  `;
  const playlistById = database.prepare(`
    ${playlistSummarySql}
    WHERE playlists.id = ?
    GROUP BY playlists.id
  `);
  const playlistList = database.prepare(`
    ${playlistSummarySql}
    GROUP BY playlists.id
    ORDER BY playlists.name COLLATE NOCASE, playlists.id
  `);
  const playlistTrackList = database.prepare(`
    SELECT tracks.id, tracks.path, tracks.title, tracks.album,
      tracks.duration_ms, tracks.status, tracks.rating, ${incompleteMetadata}
    FROM playlist_tracks
    JOIN tracks ON tracks.id = playlist_tracks.track_id
    WHERE playlist_tracks.playlist_id = ?
    ORDER BY playlist_tracks.position
  `);
  const trackPlaylistList = database.prepare(`
    SELECT playlists.id, playlists.name
    FROM playlists JOIN playlist_tracks
      ON playlist_tracks.playlist_id = playlists.id
    WHERE playlist_tracks.track_id = ?
    ORDER BY playlists.name COLLATE NOCASE, playlists.id
  `);
  const playlistTrackIds = database.prepare(
    'SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position',
  );
  const maximumPlaylistPosition = database.prepare(
    'SELECT max(position) AS maximum FROM playlist_tracks WHERE playlist_id = ?',
  );
  const playlistExists = database.prepare(
    'SELECT id FROM playlists WHERE id = ?',
  );
  const libraryTrackExists = database.prepare(
    'SELECT id FROM tracks WHERE id = ?',
  );
  const playlistNameExists = database.prepare(
    'SELECT id FROM playlists WHERE name = ?',
  );
  const genreIdsExist = (ids: number[]) => {
    if (!ids.length) return true;
    const placeholders = ids.map(() => '?').join(', ');
    const rows = database
      .prepare(`SELECT id FROM genres WHERE id IN (${placeholders})`)
      .all(...ids) as { id: number }[];
    return rows.length === ids.length;
  };
  const artistIdsExist = (ids: number[]) => {
    if (!ids.length) return true;
    const placeholders = ids.map(() => '?').join(', ');
    const rows = database
      .prepare(`SELECT id FROM artists WHERE id IN (${placeholders})`)
      .all(...ids) as { id: number }[];
    return rows.length === ids.length;
  };
  const trackFilterQuery = (filter: TrackFilter) => {
    const validated = validateTrackFilter(filter);
    if (
      !artistIdsExist(validated.artistIds) ||
      !genreIdsExist(validated.requiredGenreIds) ||
      !genreIdsExist(validated.excludedGenreIds)
    )
      throw new Error('Invalid track filter.');

    const where = ["tracks.status = 'present'"];
    const params: (number | string)[] = [];
    if (validated.text) {
      const escaped = `%${validated.text.replace(/[\\%_]/g, '\\$&')}%`;
      where.push(`(
        tracks.title LIKE ? ESCAPE '\\'
        OR tracks.album LIKE ? ESCAPE '\\'
        OR tracks.path LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM track_artists ta
          JOIN artists a ON a.id = ta.artist_id
          WHERE ta.track_id = tracks.id AND a.name LIKE ? ESCAPE '\\'
        )
        OR EXISTS (
          SELECT 1 FROM track_genres tg
          JOIN genres g ON g.id = tg.genre_id
          WHERE tg.track_id = tracks.id AND g.name LIKE ? ESCAPE '\\'
        )
      )`);
      params.push(escaped, escaped, escaped, escaped, escaped);
    }
    if (validated.artistIds.length) {
      const placeholders = validated.artistIds.map(() => '?').join(', ');
      if (validated.artistMatch === 'all') {
        where.push(`
          tracks.id IN (
            SELECT track_id FROM track_artists
            WHERE artist_id IN (${placeholders})
            GROUP BY track_id
            HAVING count(DISTINCT artist_id) = ?
          )
        `);
        params.push(...validated.artistIds, validated.artistIds.length);
      } else {
        where.push(`
          EXISTS (
            SELECT 1 FROM track_artists
            WHERE track_id = tracks.id AND artist_id IN (${placeholders})
          )
        `);
        params.push(...validated.artistIds);
      }
    }
    if (validated.requiredGenreIds.length) {
      const placeholders = validated.requiredGenreIds.map(() => '?').join(', ');
      where.push(`
        tracks.id IN (
          SELECT track_id FROM track_genres
          WHERE genre_id IN (${placeholders})
          GROUP BY track_id
          HAVING count(DISTINCT genre_id) = ?
        )
      `);
      params.push(
        ...validated.requiredGenreIds,
        validated.requiredGenreIds.length,
      );
    }
    if (validated.excludedGenreIds.length) {
      const placeholders = validated.excludedGenreIds.map(() => '?').join(', ');
      where.push(`
        NOT EXISTS (
          SELECT 1 FROM track_genres
          WHERE track_id = tracks.id AND genre_id IN (${placeholders})
        )
      `);
      params.push(...validated.excludedGenreIds);
    }
    if (validated.minRating !== null) {
      where.push('tracks.rating >= ?');
      params.push(validated.minRating);
    }
    if (validated.maxRating !== null) {
      where.push('tracks.rating <= ?');
      params.push(validated.maxRating);
    }
    if (validated.minDurationSeconds !== null) {
      where.push('tracks.duration_ms >= ?');
      params.push(validated.minDurationSeconds * 1000);
    }
    if (validated.maxDurationSeconds !== null) {
      where.push('tracks.duration_ms <= ?');
      params.push(validated.maxDurationSeconds * 1000);
    }
    if (validated.dad !== 'any') {
      where.push(
        validated.dad === 'yes'
          ? 'tracks.is_dad = 1'
          : '(tracks.is_dad = 0 OR tracks.is_dad IS NULL)',
      );
    }
    if (validated.mlp !== 'any') {
      where.push(
        validated.mlp === 'yes'
          ? 'tracks.is_mlp = 1'
          : '(tracks.is_mlp = 0 OR tracks.is_mlp IS NULL)',
      );
    }

    return { sql: where.join(' AND '), params };
  };
  const insertPlaylist = database.prepare(
    'INSERT INTO playlists (name) VALUES (?)',
  );
  const updatePlaylistName = database.prepare(
    'UPDATE playlists SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  );
  const deletePlaylist = database.prepare('DELETE FROM playlists WHERE id = ?');
  const insertPlaylistTrack = database.prepare(`
    INSERT INTO playlist_tracks (playlist_id, track_id, position)
    SELECT ?, ?, coalesce(max(position) + 1, 0)
    FROM playlist_tracks WHERE playlist_id = ?
  `);
  const deletePlaylistTrack = database.prepare(
    'DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
  );
  const setPlaylistTrackPosition = database.prepare(
    'UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?',
  );
  const setPlaylistPositionsOffset = database.prepare(
    'UPDATE playlist_tracks SET position = position + ? WHERE playlist_id = ?',
  );
  const touchPlaylist = database.prepare(
    'UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  );
  const insertPlaylistHistory = database.prepare(`
    INSERT INTO playlist_history (track_id)
    VALUES (?)
    ON CONFLICT(track_id) DO NOTHING
  `);
  const insertGeneratedPlaylistTrack = database.prepare(`
    INSERT INTO playlist_tracks (playlist_id, track_id, position)
    VALUES (?, ?, ?)
  `);
  const compactPlaylist = (playlistIdValue: number, trackIds: number[]) => {
    if (trackIds.length === 0) return;
    const maximum =
      (
        maximumPlaylistPosition.get(playlistIdValue) as {
          maximum: number | null;
        }
      ).maximum ?? 0;
    setPlaylistPositionsOffset.run(
      maximum + trackIds.length + 1,
      playlistIdValue,
    );
    trackIds.forEach((trackIdValue, position) => {
      setPlaylistTrackPosition.run(position, playlistIdValue, trackIdValue);
    });
  };
  const tagQueries = {
    artist: {
      get: database.prepare('SELECT id, name FROM artists WHERE id = ?'),
      byName: database.prepare('SELECT id, name FROM artists WHERE name = ?'),
      insert: database.prepare('INSERT INTO artists (name) VALUES (?)'),
      rename: database.prepare('UPDATE artists SET name = ? WHERE id = ?'),
      remove: database.prepare('DELETE FROM artists WHERE id = ?'),
      trackIds: database.prepare(
        'SELECT DISTINCT track_id AS id FROM track_artists WHERE artist_id = ? ORDER BY track_id',
      ),
      list: database.prepare(`
        SELECT a.id, a.name, count(DISTINCT ta.track_id) AS track_count FROM artists a
        LEFT JOIN track_artists ta ON ta.artist_id = a.id
        GROUP BY a.id ORDER BY a.name COLLATE NOCASE, a.id
      `),
      count: database.prepare(
        'SELECT count(DISTINCT track_id) AS total FROM track_artists WHERE artist_id = ?',
      ),
      songs: database.prepare(`
        SELECT DISTINCT tracks.id, tracks.path, tracks.title, tracks.album,
          tracks.duration_ms, tracks.status, tracks.rating, ${incompleteMetadata}
        FROM tracks JOIN track_artists ta ON ta.track_id = tracks.id
        WHERE ta.artist_id = ?
        ORDER BY tracks.title COLLATE NOCASE, tracks.id LIMIT ? OFFSET ?
      `),
    },
    genre: {
      get: database.prepare('SELECT id, name FROM genres WHERE id = ?'),
      byName: database.prepare('SELECT id, name FROM genres WHERE name = ?'),
      insert: database.prepare('INSERT INTO genres (name) VALUES (?)'),
      rename: database.prepare('UPDATE genres SET name = ? WHERE id = ?'),
      remove: database.prepare('DELETE FROM genres WHERE id = ?'),
      trackIds: database.prepare(
        'SELECT track_id AS id FROM track_genres WHERE genre_id = ? ORDER BY track_id',
      ),
      list: database.prepare(`
        SELECT g.id, g.name, count(tg.track_id) AS track_count FROM genres g
        LEFT JOIN track_genres tg ON tg.genre_id = g.id
        GROUP BY g.id ORDER BY g.name COLLATE NOCASE, g.id
      `),
      count: database.prepare(
        'SELECT count(*) AS total FROM track_genres WHERE genre_id = ?',
      ),
      songs: database.prepare(`
        SELECT tracks.id, tracks.path, tracks.title, tracks.album,
          tracks.duration_ms, tracks.status, tracks.rating, ${incompleteMetadata}
        FROM tracks JOIN track_genres tg ON tg.track_id = tracks.id
        WHERE tg.genre_id = ?
        ORDER BY tracks.title COLLATE NOCASE, tracks.id LIMIT ? OFFSET ?
      `),
    },
  };

  return {
    playbackState(): PlaybackState {
      const row = readPlaybackState.get() as
        | {
            track_id: number | null;
            position_seconds: number;
            volume: number;
            id: number | null;
            path: string | null;
            title: string | null;
            album: string | null;
            duration_ms: number | null;
            status: TrackSummary['status'] | null;
            metadata_incomplete: TrackSummary['metadata_incomplete'] | null;
            rating: number | null;
          }
        | undefined;
      if (!row) throw new Error('Playback state is unavailable.');
      const { track_id: trackIdValue, position_seconds: positionSeconds } = row;
      let track: TrackSummary | null = null;
      if (trackIdValue !== null) {
        if (
          row.id === null ||
          row.path === null ||
          row.title === null ||
          row.album === null ||
          row.duration_ms === null ||
          row.status === null ||
          row.metadata_incomplete === null
        ) {
          throw new Error('Saved playback track is unavailable.');
        }
        track = {
          id: row.id,
          path: row.path,
          title: row.title,
          album: row.album,
          duration_ms: row.duration_ms,
          status: row.status,
          metadata_incomplete: row.metadata_incomplete,
          rating: row.rating,
        };
      }
      return {
        track,
        positionSeconds,
        volume: row.volume,
      };
    },
    savePlaybackState(update: PlaybackStateUpdate): void {
      const { trackId: trackIdValue, positionSeconds, volume } = update;
      if (
        (trackIdValue !== null &&
          (!Number.isSafeInteger(trackIdValue) ||
            trackIdValue < 1 ||
            !libraryTrackExists.get(trackIdValue))) ||
        typeof positionSeconds !== 'number' ||
        !Number.isFinite(positionSeconds) ||
        positionSeconds < 0 ||
        typeof volume !== 'number' ||
        !Number.isFinite(volume) ||
        volume < 0 ||
        volume > 1
      ) {
        throw new Error('Invalid playback state.');
      }
      writePlaybackState.run(
        trackIdValue,
        trackIdValue,
        positionSeconds,
        volume,
      );
    },
    tag(kind: TagKind, id: number): { id: number; name: string } | undefined {
      if (kind !== 'artist' && kind !== 'genre')
        throw new Error('Invalid tag kind.');
      return tagQueries[kind].get.get(id) as
        | { id: number; name: string }
        | undefined;
    },
    addTag(kind: TagKind, name: string): { id: number; name: string } {
      if (
        (kind !== 'artist' && kind !== 'genre') ||
        typeof name !== 'string' ||
        !name.trim() ||
        name.trim().length > 200
      ) {
        throw new Error('Invalid tag name.');
      }
      const normalized = name.trim();
      const query = tagQueries[kind];
      if (query.byName.get(normalized)) throw new Error('Tag already exists.');
      const inserted = query.insert.run(normalized);
      return { id: Number(inserted.lastInsertRowid), name: normalized };
    },
    renameEmptyTag(kind: TagKind, id: number, name: string): void {
      if (this.tagSongs(kind, id).total !== 0)
        throw new Error('Tag still has songs.');
      if (!this.tag(kind, id)) throw new Error('Tag not found.');
      if (
        typeof name !== 'string' ||
        !name.trim() ||
        name.trim().length > 200
      ) {
        throw new Error('Invalid tag name.');
      }
      const normalized = name.trim();
      const existing = tagQueries[kind].byName.get(normalized) as
        | { id: number }
        | undefined;
      if (existing && existing.id !== id)
        throw new Error('Tag already exists.');
      tagQueries[kind].rename.run(normalized, id);
    },
    tagTrackIds(kind: TagKind, id: number): number[] {
      if (!this.tag(kind, id)) throw new Error('Tag not found.');
      return (tagQueries[kind].trackIds.all(id) as { id: number }[]).map(
        ({ id: trackIdValue }) => trackIdValue,
      );
    },
    removeEmptyTag(kind: TagKind, id: number): boolean {
      if (this.tagSongs(kind, id).total !== 0) return false;
      return tagQueries[kind].remove.run(id).changes > 0;
    },
    setArtistAlias(variantName: string, targetArtistId: number): void {
      if (
        typeof variantName !== 'string' ||
        !variantName.trim() ||
        variantName.trim().length > 200 ||
        !Number.isSafeInteger(targetArtistId) ||
        targetArtistId < 1
      ) {
        throw new Error('Invalid artist alias.');
      }
      const artist = tagQueries.artist.get.get(targetArtistId) as
        | { id: number; name: string }
        | undefined;
      if (!artist) throw new Error('Artist not found.');
      const variant = variantName.trim();
      if (variant.toLocaleLowerCase() === artist.name.toLocaleLowerCase())
        return;
      saveArtistAlias.run(variant, targetArtistId);
    },
    moveArtistAliases(aliasSourceId: number, destinationId: number): void {
      if (
        !Number.isSafeInteger(aliasSourceId) ||
        aliasSourceId < 1 ||
        !Number.isSafeInteger(destinationId) ||
        destinationId < 1
      ) {
        throw new Error('Invalid artist alias destination.');
      }
      moveArtistAliases.run(destinationId, aliasSourceId);
    },
    resolveArtistNames(names: string[]): string[] {
      const resolved = names.map((name) => {
        const alias = resolveArtistAlias.get(name) as
          | { name: string }
          | undefined;
        return alias?.name ?? name;
      });
      return resolved.filter(
        (name, index) =>
          resolved.findIndex(
            (candidate) =>
              candidate.toLocaleLowerCase() === name.toLocaleLowerCase(),
          ) === index,
      );
    },
    tags(kind: TagKind): CatalogTag[] {
      if (kind !== 'artist' && kind !== 'genre')
        throw new Error('Invalid tag kind.');
      return tagQueries[kind].list.all() as CatalogTag[];
    },
    tagSongs(
      kind: TagKind,
      id: number,
      limit = 40,
      offset = 0,
    ): {
      total: number;
      rows: TrackSummary[];
    } {
      if (
        (kind !== 'artist' && kind !== 'genre') ||
        !Number.isSafeInteger(id) ||
        id < 1 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isInteger(offset) ||
        offset < 0
      ) {
        throw new Error('Invalid tag song request.');
      }
      const query = tagQueries[kind];
      return {
        total: (query.count.get(id) as { total: number }).total,
        rows: query.songs.all(id, limit, offset) as TrackSummary[],
      };
    },
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
          tags.rating,
          tags.isDad === null ? null : Number(tags.isDad),
          tags.isMlp === null ? null : Number(tags.isMlp),
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
      ratingFilter: TrackRatingFilter = 'all',
    ): { total: number; rows: TrackSummary[] } {
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        text.length > 200 ||
        !['all', '5-star', '4-star', '3-star', 'lower'].includes(ratingFilter)
      ) {
        throw new Error('Invalid search pagination or query.');
      }
      const ratingRange = ratingRanges[ratingFilter];
      const escaped = `%${text.replace(/[\\%_]/g, '\\$&')}%`;
      const params = [
        text,
        escaped,
        escaped,
        escaped,
        escaped,
        escaped,
        ratingRange === null ? null : 1,
        ratingRange?.[0] ?? null,
        ratingRange?.[1] ?? null,
      ];
      return {
        total: (searchCount.get(...params) as { total: number }).total,
        rows: searchRows.all(...params, limit, offset) as TrackSummary[],
      };
    },
    filterTracks(
      filter: TrackFilter,
      limit = 40,
      offset = 0,
    ): FilteredTrackResult {
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isSafeInteger(offset) ||
        offset < 0
      ) {
        throw new Error('Invalid filtered track pagination.');
      }
      const { sql, params } = trackFilterQuery(filter);
      const summary = database
        .prepare(
          `
          SELECT count(*) AS total,
            coalesce(sum(tracks.duration_ms), 0) AS total_duration_ms
          FROM tracks WHERE ${sql}
        `,
        )
        .get(...params) as { total: number; total_duration_ms: number };
      const rows = database
        .prepare(
          `
          SELECT tracks.id, tracks.path, tracks.title, tracks.album,
            tracks.duration_ms, tracks.status, tracks.rating, ${incompleteMetadata}
          FROM tracks WHERE ${sql}
          ORDER BY tracks.title COLLATE NOCASE, tracks.id
          LIMIT ? OFFSET ?
        `,
        )
        .all(...params, limit, offset) as TrackSummary[];
      return {
        total: summary.total,
        totalDurationMs: summary.total_duration_ms,
        rows,
      };
    },
    randomTrack(): TrackSummary | null {
      return (randomTrack.get() as TrackSummary | undefined) ?? null;
    },
    playlists(): PlaylistSummary[] {
      return playlistList.all() as PlaylistSummary[];
    },
    playlist(id: number): PlaylistSummary | undefined {
      if (!Number.isSafeInteger(id) || id < 1)
        throw new Error('Invalid playlist ID.');
      return playlistById.get(id) as PlaylistSummary | undefined;
    },
    playlistTracks(id: number): TrackSummary[] {
      if (!Number.isSafeInteger(id) || id < 1)
        throw new Error('Invalid playlist ID.');
      if (!playlistExists.get(id)) throw new Error('Playlist not found.');
      return playlistTrackList.all(id) as TrackSummary[];
    },
    trackPlaylists(trackIdValue: number): TrackPlaylist[] {
      if (!Number.isSafeInteger(trackIdValue) || trackIdValue < 1)
        throw new Error('Invalid track ID.');
      if (!libraryTrackExists.get(trackIdValue))
        throw new Error('Track not found.');
      return trackPlaylistList.all(trackIdValue) as TrackPlaylist[];
    },
    createPlaylist(name: string): PlaylistSummary {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 200)
        throw new Error('Playlist name must be between 1 and 200 characters.');
      const normalized = name.trim();
      if (playlistNameExists.get(normalized))
        throw new Error('A playlist with that name already exists.');
      const inserted = insertPlaylist.run(normalized);
      return playlistById.get(
        Number(inserted.lastInsertRowid),
      ) as PlaylistSummary;
    },
    createFilteredPlaylist(
      name: string,
      filter: TrackFilter,
    ): FilteredPlaylistResult {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 200)
        throw new Error('Playlist name must be between 1 and 200 characters.');
      const normalized = name.trim();
      const { sql, params } = trackFilterQuery(filter);
      database.exec('BEGIN IMMEDIATE');
      try {
        if (playlistNameExists.get(normalized))
          throw new Error('A playlist with that name already exists.');
        const tracks = database
          .prepare(
            `
            SELECT tracks.id, tracks.path, tracks.title, tracks.album,
              tracks.duration_ms, tracks.status, tracks.rating, ${incompleteMetadata}
            FROM tracks WHERE ${sql}
            ORDER BY tracks.title COLLATE NOCASE, tracks.id
          `,
          )
          .all(...params) as TrackSummary[];
        if (!tracks.length) {
          database.exec('COMMIT');
          return { playlist: null };
        }
        const inserted = insertPlaylist.run(normalized);
        const playlistIdValue = Number(inserted.lastInsertRowid);
        tracks.forEach((track, position) => {
          insertGeneratedPlaylistTrack.run(playlistIdValue, track.id, position);
        });
        const playlist = playlistById.get(playlistIdValue) as PlaylistSummary;
        database.exec('COMMIT');
        return { playlist };
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    renamePlaylist(id: number, name: string): PlaylistSummary {
      if (!Number.isSafeInteger(id) || id < 1)
        throw new Error('Invalid playlist ID.');
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 200)
        throw new Error('Playlist name must be between 1 and 200 characters.');
      if (!playlistExists.get(id)) throw new Error('Playlist not found.');
      const normalized = name.trim();
      const existing = playlistNameExists.get(normalized) as
        | { id: number }
        | undefined;
      if (existing && existing.id !== id)
        throw new Error('A playlist with that name already exists.');
      updatePlaylistName.run(normalized, id);
      return playlistById.get(id) as PlaylistSummary;
    },
    deletePlaylist(id: number): boolean {
      if (!Number.isSafeInteger(id) || id < 1)
        throw new Error('Invalid playlist ID.');
      return deletePlaylist.run(id).changes > 0;
    },
    addPlaylistTrack(playlistIdValue: number, trackIdValue: number): void {
      if (!Number.isSafeInteger(playlistIdValue) || playlistIdValue < 1)
        throw new Error('Invalid playlist ID.');
      if (!Number.isSafeInteger(trackIdValue) || trackIdValue < 1)
        throw new Error('Invalid track ID.');
      if (!playlistExists.get(playlistIdValue))
        throw new Error('Playlist not found.');
      if (!libraryTrackExists.get(trackIdValue))
        throw new Error('Track not found.');
      if (
        (playlistTrackIds.all(playlistIdValue) as { track_id: number }[]).some(
          ({ track_id: id }) => id === trackIdValue,
        )
      ) {
        throw new Error('Track is already in this playlist.');
      }
      insertPlaylistTrack.run(playlistIdValue, trackIdValue, playlistIdValue);
      touchPlaylist.run(playlistIdValue);
    },
    removePlaylistTrack(
      playlistIdValue: number,
      trackIdValue: number,
    ): boolean {
      if (!Number.isSafeInteger(playlistIdValue) || playlistIdValue < 1)
        throw new Error('Invalid playlist ID.');
      if (!Number.isSafeInteger(trackIdValue) || trackIdValue < 1)
        throw new Error('Invalid track ID.');
      if (!playlistExists.get(playlistIdValue))
        throw new Error('Playlist not found.');
      const trackIds = (
        playlistTrackIds.all(playlistIdValue) as { track_id: number }[]
      ).map(({ track_id: id }) => id);
      if (!trackIds.includes(trackIdValue)) return false;
      database.exec('BEGIN IMMEDIATE');
      try {
        deletePlaylistTrack.run(playlistIdValue, trackIdValue);
        compactPlaylist(
          playlistIdValue,
          trackIds.filter((id) => id !== trackIdValue),
        );
        touchPlaylist.run(playlistIdValue);
        database.exec('COMMIT');
        return true;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    movePlaylistTrack(
      playlistIdValue: number,
      trackIdValue: number,
      position: number,
    ): void {
      if (!Number.isSafeInteger(playlistIdValue) || playlistIdValue < 1)
        throw new Error('Invalid playlist ID.');
      if (!Number.isSafeInteger(trackIdValue) || trackIdValue < 1)
        throw new Error('Invalid track ID.');
      if (!Number.isSafeInteger(position) || position < 0)
        throw new Error('Invalid playlist position.');
      if (!playlistExists.get(playlistIdValue))
        throw new Error('Playlist not found.');
      const trackIds = (
        playlistTrackIds.all(playlistIdValue) as { track_id: number }[]
      ).map(({ track_id: id }) => id);
      const currentPosition = trackIds.indexOf(trackIdValue);
      if (currentPosition < 0)
        throw new Error('Track is not in this playlist.');
      if (position >= trackIds.length)
        throw new Error('Playlist position is out of range.');
      if (currentPosition === position) return;
      trackIds.splice(currentPosition, 1);
      trackIds.splice(position, 0, trackIdValue);
      database.exec('BEGIN IMMEDIATE');
      try {
        compactPlaylist(playlistIdValue, trackIds);
        touchPlaylist.run(playlistIdValue);
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    createCompletionistPlaylist(
      request: CompletionistPlaylistRequest,
    ): CompletionistPlaylistResult {
      const {
        name,
        ratingFilter,
        requiredGenreIds,
        excludedGenreIds,
        targetMinutes,
      } = request;
      if (
        typeof name !== 'string' ||
        !name.trim() ||
        name.trim().length > 200 ||
        !['all', '5-star', '4-star', '3-star', 'lower'].includes(
          ratingFilter,
        ) ||
        !Number.isSafeInteger(targetMinutes) ||
        targetMinutes < 1 ||
        targetMinutes > Number.MAX_SAFE_INTEGER / 60_000 ||
        !Array.isArray(requiredGenreIds) ||
        !Array.isArray(excludedGenreIds) ||
        requiredGenreIds.length > 100 ||
        excludedGenreIds.length > 100 ||
        [...requiredGenreIds, ...excludedGenreIds].some(
          (id) => !Number.isSafeInteger(id) || id < 1,
        ) ||
        new Set(requiredGenreIds).size !== requiredGenreIds.length ||
        new Set(excludedGenreIds).size !== excludedGenreIds.length ||
        !genreIdsExist(requiredGenreIds) ||
        !genreIdsExist(excludedGenreIds)
      ) {
        throw new Error('Invalid completionist playlist request.');
      }
      const normalizedName = name.trim();
      const range = ratingRanges[ratingFilter];
      const where = ["tracks.status = 'present'"];
      const params: (number | string)[] = [];
      if (range) {
        where.push('tracks.rating BETWEEN ? AND ?');
        params.push(...range);
      }
      if (requiredGenreIds.length) {
        const placeholders = requiredGenreIds.map(() => '?').join(', ');
        where.push(`
          tracks.id IN (
            SELECT track_id FROM track_genres
            WHERE genre_id IN (${placeholders})
            GROUP BY track_id
            HAVING count(DISTINCT genre_id) = ?
          )
        `);
        params.push(...requiredGenreIds, requiredGenreIds.length);
      }
      if (excludedGenreIds.length) {
        const placeholders = excludedGenreIds.map(() => '?').join(', ');
        where.push(`
          NOT EXISTS (
            SELECT 1 FROM track_genres
            WHERE track_id = tracks.id AND genre_id IN (${placeholders})
          )
        `);
        params.push(...excludedGenreIds);
      }
      const whereSql = where.join(' AND ');
      const matchingTracks = database.prepare(`
        SELECT tracks.id, tracks.path, tracks.title, tracks.album,
          tracks.duration_ms, tracks.status, tracks.rating, ${incompleteMetadata}
        FROM tracks
        WHERE ${whereSql}
        ORDER BY RANDOM()
      `);
      const unselectedTracks = database.prepare(`
        SELECT tracks.id, tracks.path, tracks.title, tracks.album,
          tracks.duration_ms, tracks.status, tracks.rating, ${incompleteMetadata}
        FROM tracks
        WHERE ${whereSql}
          AND NOT EXISTS (
            SELECT 1 FROM playlist_history
            WHERE playlist_history.track_id = tracks.id
          )
        ORDER BY RANDOM()
      `);
      const clearMatchingHistory = database.prepare(`
        DELETE FROM playlist_history
        WHERE track_id IN (
          SELECT tracks.id FROM tracks WHERE ${whereSql}
        )
      `);

      database.exec('BEGIN IMMEDIATE');
      try {
        if (playlistNameExists.get(normalizedName))
          throw new Error('A playlist with that name already exists.');
        const matching = matchingTracks.all(...params) as TrackSummary[];
        if (matching.length === 0) {
          database.exec('COMMIT');
          return { playlist: null, tracks: [], historyReset: false };
        }
        let candidates = unselectedTracks.all(...params) as TrackSummary[];
        let historyReset = false;
        if (candidates.length === 0) {
          clearMatchingHistory.run(...params);
          candidates = unselectedTracks.all(...params) as TrackSummary[];
          historyReset = true;
        }
        const tracks: TrackSummary[] = [];
        let duration = 0;
        const targetDuration = targetMinutes * 60_000;
        candidates.some((track) => {
          tracks.push(track);
          duration += Math.max(0, track.duration_ms);
          return duration > targetDuration;
        });
        const insertedPlaylist = insertPlaylist.run(normalizedName);
        const playlistIdValue = Number(insertedPlaylist.lastInsertRowid);
        tracks.forEach((track, position) => {
          insertGeneratedPlaylistTrack.run(playlistIdValue, track.id, position);
          insertPlaylistHistory.run(track.id);
        });
        const playlist = playlistById.get(playlistIdValue) as PlaylistSummary;
        database.exec('COMMIT');
        return { playlist, tracks, historyReset };
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
