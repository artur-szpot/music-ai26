import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  createMusicCatalog,
  initializeMusicCatalog,
} from '../main/musicCatalog';
import type { TrackFilter } from '../main/musicCatalog';
import type { MusicTags } from '../main/musicTags';

const schema = readFileSync(
  path.resolve(__dirname, '../../data/music/001_initial.sql'),
  'utf8',
);

describe('music catalog', () => {
  let database: DatabaseSync;
  const tags: MusicTags = {
    title: 'First title',
    artists: ['Artist A', 'Artist B'],
    album: 'First album',
    genres: ['Electronic'],
    year: 2024,
    track: 1,
    durationMs: 90000,
    rating: 7,
    isDad: null,
    isMlp: null,
  };

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
  });

  afterEach(() => {
    database.close();
  });

  function initialize() {
    const connection = database as unknown as Parameters<
      typeof initializeMusicCatalog
    >[0];
    initializeMusicCatalog(connection, schema);
    return createMusicCatalog(connection);
  }

  it('initializes a fresh database and rejects an unrelated one', () => {
    const catalog = initialize();
    expect(catalog.addRoot(path.resolve('music'))).toBe(1);
    initializeMusicCatalog(
      database as unknown as Parameters<typeof initializeMusicCatalog>[0],
      schema,
    );
    expect(database.prepare('PRAGMA user_version').get()).toMatchObject({
      user_version: 7,
    });
  });

  it.each<[string, Partial<MusicTags>, 0 | 1]>([
    ['complete tags', {}, 0],
    ['no artists', { artists: [] }, 1],
    ['no title', { title: '' }, 1],
    ['whitespace title', { title: ' \t\r\n ' }, 1],
    ['no genres', { genres: [] }, 1],
    ['no rating', { rating: null }, 1],
    ['zero rating', { rating: 0 }, 0],
    [
      'multiple missing tags',
      { artists: [], title: '', genres: [], rating: null },
      1,
    ],
    ['hidden fields absent', { album: '', year: 0, track: 0 }, 0],
  ])('flags %s consistently in track lists', (_name, changes, expected) => {
    const catalog = initialize();
    const rootPath = path.resolve('music');
    const sourceId = catalog.addRoot(rootPath);
    const id = catalog.upsertTrack({
      sourceId,
      filePath: path.join(rootPath, 'song.mp3'),
      sizeBytes: 100,
      mtimeMs: 1,
      tags: { ...tags, ...changes },
    });
    expect(catalog.search('').rows[0].metadata_incomplete).toBe(expected);
    expect(catalog.detail(id)?.metadata_incomplete).toBe(expected);
    catalog.tags('artist').forEach((artist) => {
      expect(
        catalog.tagSongs('artist', artist.id).rows[0].metadata_incomplete,
      ).toBe(expected);
    });
    catalog.tags('genre').forEach((genre) => {
      expect(
        catalog.tagSongs('genre', genre.id).rows[0].metadata_incomplete,
      ).toBe(expected);
    });
    catalog.markAbsent(sourceId, new Set());
    expect(catalog.search('').rows[0]).toMatchObject({
      status: 'missing',
      metadata_incomplete: expected,
    });
    catalog.upsertTrack({
      sourceId,
      filePath: path.join(rootPath, 'song.mp3'),
      sizeBytes: 100,
      mtimeMs: 2,
      tags,
    });
    expect(catalog.search('').rows[0].metadata_incomplete).toBe(0);
  });

  it('does not apply its schema to a populated database', () => {
    database.exec('CREATE TABLE personal_data (id INTEGER)');
    expect(() => initialize()).toThrow('not empty');
    expect(database.prepare('PRAGMA user_version').get()).toMatchObject({
      user_version: 0,
    });
  });

  it('upgrades a version 1 catalog without losing its tracks or tags', () => {
    database.exec(
      schema
        .replace(
          `CREATE TABLE artist_aliases (
  variant_name TEXT NOT NULL COLLATE NOCASE PRIMARY KEY
    CHECK (length(trim(variant_name)) > 0),
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE
);

CREATE INDEX artist_aliases_artist ON artist_aliases(artist_id);

`,
          '',
        )
        .replace(
          '  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 0 AND 10),\n',
          '',
        )
        .replace('PRAGMA user_version = 3', 'PRAGMA user_version = 1'),
    );
    database.exec(`
        INSERT INTO sources (id, root_path) VALUES (1, 'legacy-root');
        INSERT INTO tracks (
          id, source_id, path, format, size_bytes, mtime_ms, title, album, duration_ms
        ) VALUES (1, 1, 'legacy-root/song.mp3', 'mp3', 100, 1, 'Legacy', 'Album', 1000);
        INSERT INTO artists (id, name) VALUES (1, 'Artist');
        INSERT INTO track_artists (track_id, artist_id, position) VALUES (1, 1, 0);
      `);
    const catalog = initialize();
    expect(catalog.detail(1)).toMatchObject({
      title: 'Legacy',
      album: 'Album',
      artists: ['Artist'],
      rating: null,
    });
    expect(database.prepare('PRAGMA user_version').get()).toMatchObject({
      user_version: 7,
    });
    initialize();
  });

  it('upgrades a version 2 catalog to persist aliases, playlists and history', () => {
    const version2Schema = schema
      .replace(
        `CREATE TABLE artist_aliases (
  variant_name TEXT NOT NULL COLLATE NOCASE PRIMARY KEY
    CHECK (length(trim(variant_name)) > 0),
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE
);

CREATE INDEX artist_aliases_artist ON artist_aliases(artist_id);

`,
        '',
      )
      .replace('PRAGMA user_version = 3', 'PRAGMA user_version = 2');
    database.exec(version2Schema);
    database.exec(`
      INSERT INTO sources (id, root_path) VALUES (1, 'legacy-root');
      INSERT INTO artists (id, name) VALUES (1, 'Legacy Artist');
    `);

    const catalog = initialize();
    expect(database.prepare('PRAGMA user_version').get()).toMatchObject({
      user_version: 7,
    });
    expect(catalog.tags('artist')).toMatchObject([
      { id: 1, name: 'Legacy Artist', track_count: 0 },
    ]);
    catalog.setArtistAlias('Legacy spelling', 1);
    expect(catalog.resolveArtistNames(['Legacy spelling'])).toEqual([
      'Legacy Artist',
    ]);
  });

  it('migrates a version 4 catalog without losing playlists or tracks', () => {
    database.exec(schema);
    database.exec(`
      INSERT INTO sources (id, root_path) VALUES (1, 'legacy-root');
      INSERT INTO tracks (
        id, source_id, path, format, size_bytes, mtime_ms, title, album,
        duration_ms, rating
      ) VALUES (1, 1, 'legacy-root/song.mp3', 'mp3', 100, 1, 'Legacy', 'Album', 1000, 8);
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
      INSERT INTO playlists (id, name) VALUES (1, 'Legacy playlist');
      INSERT INTO playlist_tracks (playlist_id, track_id, position)
        VALUES (1, 1, 0);
      PRAGMA user_version = 4;
    `);

    const catalog = initialize();
    expect(database.prepare('PRAGMA user_version').get()).toMatchObject({
      user_version: 7,
    });
    expect(catalog.playlistTracks(1)).toMatchObject([
      { id: 1, title: 'Legacy' },
    ]);
    expect(
      database.prepare('SELECT count(*) AS total FROM playlist_history').get(),
    ).toMatchObject({ total: 0 });
  });

  it('stores and restores the last playback track, position and volume', () => {
    const catalog = initialize();
    const rootPath = path.resolve('music');
    const sourceId = catalog.addRoot(rootPath);
    const trackId = catalog.upsertTrack({
      sourceId,
      filePath: path.join(rootPath, 'song.mp3'),
      sizeBytes: 100,
      mtimeMs: 1,
      tags,
    });

    expect(catalog.playbackState()).toMatchObject({
      track: null,
      positionSeconds: 0,
      volume: 1,
    });
    catalog.savePlaybackState({
      trackId,
      positionSeconds: 47.5,
      volume: 0.35,
    });
    expect(catalog.playbackState()).toMatchObject({
      track: { id: trackId, title: 'First title', status: 'present' },
      positionSeconds: 47.5,
      volume: 0.35,
    });
    catalog.savePlaybackState({
      trackId: null,
      positionSeconds: 0,
      volume: 0.5,
    });
    expect(catalog.playbackState()).toMatchObject({
      track: { id: trackId },
      positionSeconds: 47.5,
      volume: 0.5,
    });
    expect(() =>
      catalog.savePlaybackState({
        trackId: 999,
        positionSeconds: 0,
        volume: 0.5,
      }),
    ).toThrow('Invalid playback state.');
    expect(() =>
      catalog.savePlaybackState({
        trackId,
        positionSeconds: -1,
        volume: 0.5,
      }),
    ).toThrow('Invalid playback state.');
    expect(() =>
      catalog.savePlaybackState({
        trackId,
        positionSeconds: 0,
        volume: 1.1,
      }),
    ).toThrow('Invalid playback state.');
  });

  it('generates random completionist playlists using filters, duration and rotating history', () => {
    const catalog = initialize();
    const rootPath = path.resolve('music');
    const sourceId = catalog.addRoot(rootPath);
    const trackIds = Array.from({ length: 4 }, (_, index) =>
      catalog.upsertTrack({
        sourceId,
        filePath: path.join(rootPath, `eligible-${index}.mp3`),
        sizeBytes: 100 + index,
        mtimeMs: index,
        tags: {
          ...tags,
          title: `Eligible ${index}`,
          genres: ['Ambient', 'Instrumental'],
          rating: 10,
          durationMs: 30_000,
        },
      }),
    );
    const excludedIds = [
      catalog.upsertTrack({
        sourceId,
        filePath: path.join(rootPath, 'disallowed.mp3'),
        sizeBytes: 200,
        mtimeMs: 5,
        tags: {
          ...tags,
          title: 'Disallowed',
          genres: ['Ambient', 'Instrumental', 'Rock'],
          rating: 10,
          durationMs: 30_000,
        },
      }),
      catalog.upsertTrack({
        sourceId,
        filePath: path.join(rootPath, 'lower-rated.mp3'),
        sizeBytes: 201,
        mtimeMs: 6,
        tags: {
          ...tags,
          title: 'Lower rated',
          genres: ['Ambient', 'Instrumental'],
          rating: 8,
          durationMs: 30_000,
        },
      }),
      catalog.upsertTrack({
        sourceId,
        filePath: path.join(rootPath, 'offline.mp3'),
        sizeBytes: 202,
        mtimeMs: 7,
        tags: {
          ...tags,
          title: 'Offline',
          genres: ['Ambient', 'Instrumental'],
          rating: 10,
          durationMs: 30_000,
        },
      }),
    ];
    const offlinePath = path.join(rootPath, 'offline.mp3');
    catalog.markAbsent(
      sourceId,
      new Set(
        trackIds
          .map((id) => catalog.detail(id)!.path)
          .concat(
            catalog.detail(excludedIds[0])!.path,
            catalog.detail(excludedIds[1])!.path,
          ),
      ),
    );
    const genres = catalog.tags('genre');
    const requiredGenreIds = [
      genres.find(({ name }) => name === 'Ambient')!.id,
      genres.find(({ name }) => name === 'Instrumental')!.id,
    ];
    const excludedGenreIds = [genres.find(({ name }) => name === 'Rock')!.id];
    const request = {
      name: 'First Rotation',
      ratingFilter: '5-star' as const,
      requiredGenreIds,
      excludedGenreIds,
      targetMinutes: 1,
    };

    const first = catalog.createCompletionistPlaylist(request);
    expect(first.playlist).toMatchObject({ name: 'First Rotation' });
    expect(first.historyReset).toBe(false);
    expect(first.tracks).toHaveLength(3);
    expect(
      first.tracks.reduce((sum, track) => sum + track.duration_ms, 0),
    ).toBeGreaterThan(60_000);
    expect(first.tracks.every(({ id }) => trackIds.includes(id))).toBe(true);
    expect(first.tracks.map(({ id }) => id)).toEqual(
      catalog.playlistTracks(first.playlist!.id).map(({ id }) => id),
    );

    const second = catalog.createCompletionistPlaylist({
      ...request,
      name: 'Second Rotation',
    });
    expect(second.historyReset).toBe(false);
    expect(second.tracks).toHaveLength(1);
    expect(first.tracks.map(({ id }) => id)).not.toContain(second.tracks[0].id);

    const third = catalog.createCompletionistPlaylist({
      ...request,
      name: 'Third Rotation',
    });
    expect(third.historyReset).toBe(true);
    expect(third.tracks).toHaveLength(3);
    expect(new Set(third.tracks.map(({ id }) => id)).size).toBe(3);
    expect(
      database.prepare('SELECT count(*) AS total FROM playlist_history').get(),
    ).toMatchObject({ total: 3 });
    expect(
      database.prepare('SELECT count(*) AS total FROM playlist_tracks').get(),
    ).toMatchObject({ total: 7 });
    expect(catalog.detail(excludedIds[0])?.title).toBe('Disallowed');
    expect(catalog.detail(excludedIds[2])?.path).toBe(offlinePath);
    expect(
      catalog.createCompletionistPlaylist({
        ...request,
        name: 'No matches',
        requiredGenreIds: [excludedGenreIds[0]],
        excludedGenreIds: [excludedGenreIds[0]],
      }),
    ).toMatchObject({
      playlist: null,
      tracks: [],
      historyReset: false,
    });
    expect(() =>
      catalog.createCompletionistPlaylist({
        ...request,
        name: 'Invalid duration',
        targetMinutes: 0,
      }),
    ).toThrow('Invalid completionist');
    expect(() =>
      catalog.createCompletionistPlaylist({
        ...request,
        name: 'Invalid genre',
        requiredGenreIds: [999],
      }),
    ).toThrow('Invalid completionist');
  });

  it('creates and manages ordered playlists without changing library tracks', () => {
    const catalog = initialize();
    const rootPath = path.resolve('music');
    const sourceId = catalog.addRoot(rootPath);
    const firstId = catalog.upsertTrack({
      sourceId,
      filePath: path.join(rootPath, 'first.mp3'),
      sizeBytes: 100,
      mtimeMs: 1,
      tags: { ...tags, title: 'First', durationMs: 1000, rating: 8 },
    });
    const secondId = catalog.upsertTrack({
      sourceId,
      filePath: path.join(rootPath, 'second.mp3'),
      sizeBytes: 200,
      mtimeMs: 2,
      tags: { ...tags, title: 'Second', durationMs: 2000, rating: null },
    });
    const thirdId = catalog.upsertTrack({
      sourceId,
      filePath: path.join(rootPath, 'third.mp3'),
      sizeBytes: 300,
      mtimeMs: 3,
      tags: { ...tags, title: 'Third', durationMs: 3000, rating: 10 },
    });
    const playlist = catalog.createPlaylist(' Road Mix ');

    expect(playlist).toMatchObject({
      name: 'Road Mix',
      track_count: 0,
      total_duration_ms: 0,
      average_rating: null,
    });
    catalog.addPlaylistTrack(playlist.id, firstId);
    catalog.addPlaylistTrack(playlist.id, secondId);
    catalog.addPlaylistTrack(playlist.id, thirdId);
    expect(() => catalog.addPlaylistTrack(playlist.id, firstId)).toThrow(
      'already in this playlist',
    );
    expect(catalog.playlistTracks(playlist.id).map(({ id }) => id)).toEqual([
      firstId,
      secondId,
      thirdId,
    ]);
    expect(catalog.playlist(playlist.id)).toMatchObject({
      track_count: 3,
      total_duration_ms: 6000,
      average_rating: 9,
    });
    expect(catalog.trackPlaylists(firstId)).toEqual([
      { id: playlist.id, name: 'Road Mix' },
    ]);

    catalog.movePlaylistTrack(playlist.id, thirdId, 0);
    expect(catalog.playlistTracks(playlist.id).map(({ id }) => id)).toEqual([
      thirdId,
      firstId,
      secondId,
    ]);
    expect(catalog.removePlaylistTrack(playlist.id, firstId)).toBe(true);
    expect(catalog.removePlaylistTrack(playlist.id, firstId)).toBe(false);
    expect(catalog.playlistTracks(playlist.id).map(({ id }) => id)).toEqual([
      thirdId,
      secondId,
    ]);
    expect(catalog.renamePlaylist(playlist.id, 'Road Mix 2').name).toBe(
      'Road Mix 2',
    );
    expect(catalog.trackPlaylists(firstId)).toEqual([]);
    expect(catalog.detail(firstId)?.title).toBe('First');

    const empty = catalog.createPlaylist('Empty');
    expect(catalog.playlists()).toHaveLength(2);
    expect(catalog.playlists()[0]).toMatchObject({
      id: empty.id,
      average_rating: null,
    });
    expect(catalog.deletePlaylist(playlist.id)).toBe(true);
    expect(catalog.deletePlaylist(playlist.id)).toBe(false);
    expect(catalog.detail(secondId)?.title).toBe('Second');
    expect(
      database.prepare('SELECT count(*) AS total FROM tracks').get(),
    ).toMatchObject({
      total: 3,
    });
    expect(() => catalog.createPlaylist(' empty ')).toThrow('already exists');
    expect(() => catalog.renamePlaylist(empty.id, '   ')).toThrow(
      'between 1 and 200 characters',
    );
  });

  it('upserts tags without duplicating tracks or changing their id', () => {
    const catalog = initialize();
    const rootPath = path.resolve('music');
    const sourceId = catalog.addRoot(rootPath);
    expect(catalog.addRoot(rootPath)).toBe(sourceId);
    const scanned = {
      sourceId,
      filePath: path.join(rootPath, 'song.flac'),
      sizeBytes: 1234,
      mtimeMs: 5678,
      tags,
    };
    const trackId = catalog.upsertTrack(scanned);
    expect(
      catalog.upsertTrack({
        ...scanned,
        tags: {
          ...tags,
          title: 'Second title',
          artists: ['Artist B'],
          rating: 10,
        },
      }),
    ).toBe(trackId);
    expect(
      database.prepare('SELECT id, title FROM tracks').all(),
    ).toMatchObject([{ id: trackId, title: 'Second title' }]);
    expect(catalog.detail(trackId)?.rating).toBe(10);
    expect(
      database
        .prepare(
          'SELECT a.name FROM track_artists ta JOIN artists a ON a.id = ta.artist_id ORDER BY ta.position',
        )
        .all(),
    ).toMatchObject([{ name: 'Artist B' }]);
  });

  it('refuses paths outside the root and rolls back failed tag writes', () => {
    const catalog = initialize();
    const rootPath = path.resolve('music');
    const sourceId = catalog.addRoot(rootPath);
    const scanned = {
      sourceId,
      filePath: path.join(rootPath, 'song.mp3'),
      sizeBytes: 1234,
      mtimeMs: 5678,
      tags,
    };
    expect(() =>
      catalog.upsertTrack({
        ...scanned,
        filePath: path.resolve('outside.mp3'),
      }),
    ).toThrow('inside its source root');
    expect(() =>
      catalog.upsertTrack({
        ...scanned,
        tags: { ...tags, artists: ['Artist A', ''] },
      }),
    ).toThrow();
    expect(
      database.prepare('SELECT count(*) AS total FROM tracks').get(),
    ).toMatchObject({
      total: 0,
    });
  });

  it('searches related tags, escapes wildcard input and retains missing tracks', () => {
    const catalog = initialize();
    const rootPath = path.resolve('music');
    const sourceId = catalog.addRoot(rootPath);
    const firstPath = path.join(rootPath, 'first.mp3');
    catalog.upsertTrack({
      sourceId,
      filePath: firstPath,
      sizeBytes: 123,
      mtimeMs: 1,
      tags: { ...tags, title: '100% Music', genres: ['Synth_wave'] },
    });
    catalog.upsertTrack({
      sourceId,
      filePath: path.join(rootPath, 'second.m4a'),
      sizeBytes: 456,
      mtimeMs: 2,
      tags: { ...tags, title: 'Another song', artists: ['Singer'] },
    });

    expect(catalog.search('100%').rows).toMatchObject([
      { title: '100% Music' },
    ]);
    expect(catalog.search('Synth_').rows).toMatchObject([
      { title: '100% Music' },
    ]);
    expect(catalog.search('Singer').rows).toMatchObject([
      { title: 'Another song' },
    ]);
    expect(catalog.search('100%', 1, 0).total).toBe(1);
    expect(catalog.search('', 1, 1).rows).toMatchObject([
      { title: 'Another song' },
    ]);
    expect(catalog.markAbsent(sourceId, new Set([firstPath]))).toBe(1);
    expect(catalog.search('Another').rows).toMatchObject([
      { status: 'missing' },
    ]);
    expect(() => catalog.search('', 1000)).toThrow('Invalid search');
  });

  it('filters tracks by rating range', () => {
    const catalog = initialize();
    const rootPath = path.resolve('music');
    const sourceId = catalog.addRoot(rootPath);
    [10, 9, 8, 7, 6, 5, 4, 0, null].forEach((rating, index) => {
      catalog.upsertTrack({
        sourceId,
        filePath: path.join(rootPath, `track-${index}.mp3`),
        sizeBytes: 100,
        mtimeMs: index,
        tags: {
          ...tags,
          title: `Track ${index}`,
          rating,
        },
      });
    });

    expect(catalog.search('', 100, 0, '5-star').total).toBe(2);
    expect(catalog.search('', 100, 0, '4-star').total).toBe(2);
    expect(catalog.search('', 100, 0, '3-star').total).toBe(2);
    expect(catalog.search('', 100, 0, 'lower').total).toBe(2);
    expect(catalog.search('', 100, 0, 'all').total).toBe(9);
    expect(catalog.search('Track', 1, 0, '5-star').total).toBe(2);
  });

  it('previews present tracks with combined filters and saves them in preview order', () => {
    const catalog = initialize();
    const rootPath = path.resolve('music');
    const sourceId = catalog.addRoot(rootPath);
    const tracks = [
      {
        file: 'Alpha.mp3',
        title: 'Alpha',
        artists: ['Artist A', 'Artist B'],
        genres: ['Rock', 'Jazz'],
        rating: 7,
        durationMs: 90000,
      },
      {
        file: 'Beta.mp3',
        title: 'Beta',
        artists: ['Artist A'],
        genres: ['Rock'],
        rating: 9,
        durationMs: 120000,
      },
      {
        file: 'Gamma.mp3',
        title: 'Gamma',
        artists: ['Artist B'],
        genres: ['Jazz'],
        rating: 8,
        durationMs: 120000,
      },
      {
        file: 'Delta.mp3',
        title: 'Delta',
        artists: ['Artist A'],
        genres: ['Rock'],
        rating: 8,
        durationMs: 120001,
      },
      {
        file: 'Offline.mp3',
        title: 'Offline',
        artists: ['Artist A'],
        genres: ['Rock'],
        rating: 8,
        durationMs: 100000,
      },
      {
        file: 'Unrated.mp3',
        title: 'Unrated',
        artists: ['Artist A'],
        genres: ['Rock'],
        rating: null,
        durationMs: 100000,
      },
    ];
    const presentPaths = tracks
      .filter(({ file }) => file !== 'Offline.mp3')
      .map(({ file }) => path.join(rootPath, file));
    tracks.forEach((track, index) => {
      catalog.upsertTrack({
        sourceId,
        filePath: path.join(rootPath, track.file),
        sizeBytes: 100,
        mtimeMs: index,
        tags: {
          ...tags,
          title: track.title,
          artists: track.artists,
          genres: track.genres,
          rating: track.rating,
          durationMs: track.durationMs,
        },
      });
    });
    catalog.markAbsent(sourceId, new Set(presentPaths));
    const artistIds = catalog.tags('artist');
    const genreIds = catalog.tags('genre');
    const artistA = artistIds.find(({ name }) => name === 'Artist A')!.id;
    const artistB = artistIds.find(({ name }) => name === 'Artist B')!.id;
    const rock = genreIds.find(({ name }) => name === 'Rock')!.id;
    const jazz = genreIds.find(({ name }) => name === 'Jazz')!.id;
    const filter: TrackFilter = {
      text: '',
      artistIds: [artistA, artistB],
      artistMatch: 'any',
      requiredGenreIds: [rock],
      excludedGenreIds: [jazz],
      minRating: 7,
      maxRating: 9,
      minDurationSeconds: 90,
      maxDurationSeconds: 120,
      dad: 'any',
      mlp: 'any',
    };

    expect(catalog.filterTracks(filter)).toMatchObject({
      total: 1,
      totalDurationMs: 120000,
      rows: [{ title: 'Beta', status: 'present' }],
    });
    expect(catalog.filterTracks({ ...filter, text: 'B%' }).total).toBe(0);

    const artistAll = catalog.filterTracks({
      ...filter,
      artistMatch: 'all',
      requiredGenreIds: [],
      excludedGenreIds: [],
      minRating: null,
      maxRating: null,
      minDurationSeconds: null,
      maxDurationSeconds: null,
    });
    expect(artistAll.rows.map(({ title }) => title)).toEqual(['Alpha']);

    const requiredGenres = catalog.filterTracks({
      ...filter,
      artistIds: [],
      requiredGenreIds: [rock, jazz],
      excludedGenreIds: [],
      minRating: null,
      maxRating: null,
      minDurationSeconds: null,
      maxDurationSeconds: null,
    });
    expect(requiredGenres.rows.map(({ title }) => title)).toEqual(['Alpha']);

    const page = catalog.filterTracks(
      { ...filter, artistIds: [], requiredGenreIds: [], excludedGenreIds: [] },
      1,
      1,
    );
    expect(page.rows.map(({ title }) => title)).toEqual(['Beta']);
    expect(page.total).toBe(3);

    const createFilter = {
      ...filter,
      artistIds: [],
      minRating: null,
      maxRating: null,
      minDurationSeconds: null,
      maxDurationSeconds: null,
    };
    const created = catalog.createFilteredPlaylist('Filtered', createFilter);
    expect(created.playlist).toMatchObject({
      name: 'Filtered',
      track_count: 3,
      total_duration_ms: 340001,
    });
    expect(
      catalog.playlistTracks(created.playlist!.id).map(({ title }) => title),
    ).toEqual(['Beta', 'Delta', 'Unrated']);
    expect(
      catalog.createFilteredPlaylist('No matches', {
        ...filter,
        minRating: 10,
        maxRating: 10,
      }),
    ).toEqual({ playlist: null });
    expect(() =>
      catalog.filterTracks({ ...filter, minRating: 10, maxRating: 4 }),
    ).toThrow('Invalid track filter.');
    expect(() =>
      catalog.filterTracks({ ...filter, dad: 'maybe' as never }),
    ).toThrow('Invalid track filter.');
  });

  it('filters tracks by dad and MLP flags', () => {
    const catalog = initialize();
    const rootPath = path.resolve('music');
    const sourceId = catalog.addRoot(rootPath);
    const flagTracks = [
      { file: 'Dad.mp3', title: 'Dad', isDad: true, isMlp: null },
      { file: 'Mlp.mp3', title: 'Mlp', isDad: false, isMlp: true },
      { file: 'Both.mp3', title: 'Both', isDad: true, isMlp: true },
      { file: 'Neither.mp3', title: 'Neither', isDad: null, isMlp: false },
    ];
    flagTracks.forEach((track, index) => {
      catalog.upsertTrack({
        sourceId,
        filePath: path.join(rootPath, track.file),
        sizeBytes: 100,
        mtimeMs: index,
        tags: {
          ...tags,
          title: track.title,
          isDad: track.isDad,
          isMlp: track.isMlp,
        },
      });
    });
    const base: TrackFilter = {
      text: '',
      artistIds: [],
      artistMatch: 'any',
      requiredGenreIds: [],
      excludedGenreIds: [],
      minRating: null,
      maxRating: null,
      minDurationSeconds: null,
      maxDurationSeconds: null,
      dad: 'any',
      mlp: 'any',
    };
    const titles = (changes: Partial<TrackFilter>) =>
      catalog
        .filterTracks({ ...base, ...changes })
        .rows.map(({ title }) => title);
    expect(titles({})).toEqual(['Both', 'Dad', 'Mlp', 'Neither']);
    expect(titles({ dad: 'yes' })).toEqual(['Both', 'Dad']);
    expect(titles({ dad: 'no' })).toEqual(['Mlp', 'Neither']);
    expect(titles({ mlp: 'yes' })).toEqual(['Both', 'Mlp']);
    expect(titles({ mlp: 'no' })).toEqual(['Dad', 'Neither']);
    expect(titles({ dad: 'yes', mlp: 'yes' })).toEqual(['Both']);
  });

  it('selects a random present track and returns null for an empty collection', () => {
    const catalog = initialize();
    expect(catalog.randomTrack()).toBeNull();
    const rootPath = path.resolve('music');
    const sourceId = catalog.addRoot(rootPath);
    const presentId = catalog.upsertTrack({
      sourceId,
      filePath: path.join(rootPath, 'present.mp3'),
      sizeBytes: 100,
      mtimeMs: 1,
      tags,
    });
    catalog.upsertTrack({
      sourceId,
      filePath: path.join(rootPath, 'missing.mp3'),
      sizeBytes: 100,
      mtimeMs: 2,
      tags,
    });
    catalog.markAbsent(sourceId, new Set([path.join(rootPath, 'present.mp3')]));

    expect(catalog.randomTrack()).toMatchObject({
      id: presentId,
      status: 'present',
      title: 'First title',
    });
  });

  it('lists artist and genre tags and pages through their linked songs', () => {
    const catalog = initialize();
    const root = path.resolve('music');
    const sourceId = catalog.addRoot(root);
    catalog.upsertTrack({
      sourceId,
      filePath: path.join(root, 'one.mp3'),
      sizeBytes: 10,
      mtimeMs: 1,
      tags: {
        ...tags,
        artists: ['Singer', 'Producer', 'Singer'],
        genres: ['Dance'],
      },
    });
    catalog.upsertTrack({
      sourceId,
      filePath: path.join(root, 'two.flac'),
      sizeBytes: 20,
      mtimeMs: 2,
      tags: {
        ...tags,
        title: 'Second title',
        artists: ['Singer'],
        genres: ['Dance'],
      },
    });
    const singer = catalog.tags('artist').find(({ name }) => name === 'Singer');
    const dance = catalog.tags('genre').find(({ name }) => name === 'Dance');
    expect(singer).toMatchObject({ track_count: 2 });
    expect(dance).toMatchObject({ track_count: 2 });
    expect(catalog.tagSongs('artist', singer!.id, 1, 1)).toMatchObject({
      total: 2,
      rows: [{ title: 'Second title' }],
    });
    expect(catalog.tagSongs('genre', dance!.id).total).toBe(2);
    expect(catalog.tagTrackIds('artist', singer!.id)).toHaveLength(2);
    expect(() => catalog.tagSongs('genre', dance!.id, 200)).toThrow(
      'Invalid tag song',
    );
  });

  it('creates empty tags and guards rename and removal while songs are linked', () => {
    const catalog = initialize();
    const artist = catalog.addTag('artist', '  Singer  ');
    const genre = catalog.addTag('genre', 'Downtempo');
    expect(artist.name).toBe('Singer');
    expect(catalog.tags('genre')).toContainEqual({ ...genre, track_count: 0 });
    expect(() => catalog.addTag('artist', 'singer')).toThrow('already exists');
    catalog.renameEmptyTag('artist', artist.id, 'Vocalist');
    expect(catalog.tag('artist', artist.id)?.name).toBe('Vocalist');

    const root = path.resolve('music');
    const sourceId = catalog.addRoot(root);
    catalog.upsertTrack({
      sourceId,
      filePath: path.join(root, 'song.mp3'),
      sizeBytes: 10,
      mtimeMs: 1,
      tags: { ...tags, artists: ['Vocalist'], genres: ['Downtempo'] },
    });
    expect(catalog.tagTrackIds('artist', artist.id)).toHaveLength(1);
    expect(() => catalog.renameEmptyTag('artist', artist.id, 'Other')).toThrow(
      'still has songs',
    );
    expect(catalog.removeEmptyTag('genre', genre.id)).toBe(false);
    expect(catalog.removeEmptyTag('artist', artist.id)).toBe(false);
  });
});
