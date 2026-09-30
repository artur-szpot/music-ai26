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
      user_version: 1,
    });
  });

  it('does not apply its schema to a populated database', () => {
    database.exec('CREATE TABLE personal_data (id INTEGER)');
    expect(() => initialize()).toThrow('not empty');
    expect(database.prepare('PRAGMA user_version').get()).toMatchObject({
      user_version: 0,
    });
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
        tags: { ...tags, title: 'Second title', artists: ['Artist B'] },
      }),
    ).toBe(trackId);
    expect(
      database.prepare('SELECT id, title FROM tracks').all(),
    ).toMatchObject([{ id: trackId, title: 'Second title' }]);
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
});
