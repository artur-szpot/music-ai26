import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  createMusicCatalog,
  initializeMusicCatalog,
} from '../main/musicCatalog';
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
      user_version: 2,
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
          '  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 0 AND 10),\n',
          '',
        )
        .replace('PRAGMA user_version = 2', 'PRAGMA user_version = 1'),
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
      user_version: 2,
    });
    initialize();
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
