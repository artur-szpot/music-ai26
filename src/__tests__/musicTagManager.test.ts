import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  createMusicCatalog,
  initializeMusicCatalog,
} from '../main/musicCatalog';
import { createMusicTagManager } from '../main/musicTagManager';
import type { MusicTagEdit, MusicTags } from '../main/musicTags';

jest.mock('node-taglib-sharp', () => ({ File: { createFromPath: jest.fn() } }));

const schema = fs.readFileSync(
  path.resolve(__dirname, '../../data/music/001_initial.sql'),
  'utf8',
);

describe('file-backed tag management', () => {
  let database: DatabaseSync;
  let root: string;
  let catalog: ReturnType<typeof createMusicCatalog>;
  let writeTags: jest.Mock<MusicTags, [string, MusicTagEdit]>;
  const initial: MusicTags = {
    title: 'Sample',
    artists: ['Mispeled', 'Correct'],
    album: 'Album',
    genres: ['Downtempo'],
    year: 2024,
    track: 1,
    durationMs: 1000,
    rating: 7,
  };

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'tag-merge-')),
    );
    database = new DatabaseSync(':memory:');
    const connection = database as unknown as Parameters<
      typeof createMusicCatalog
    >[0];
    initializeMusicCatalog(connection, schema);
    catalog = createMusicCatalog(connection);
    writeTags = jest.fn((_filePath, changes) => ({ ...initial, ...changes }));
  });

  afterEach(() => {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function addSong(fileName: string, tags = initial): number {
    const filePath = path.join(root, fileName);
    fs.writeFileSync(filePath, 'disposable test data');
    const stats = fs.statSync(filePath);
    return catalog.upsertTrack({
      sourceId: catalog.addRoot(root),
      filePath,
      sizeBytes: stats.size,
      mtimeMs: stats.mtimeMs,
      tags,
    });
  }

  it('renames a linked artist through embedded tags and preserves its song', () => {
    const id = addSong('one.mp3');
    const source = catalog
      .tags('artist')
      .find(({ name }) => name === 'Mispeled')!;
    const result = createMusicTagManager(catalog, writeTags).move(
      'artist',
      source.id,
      'Corrected',
    );
    expect(result).toMatchObject({ updated: 1, remaining: 0, errors: [] });
    expect(writeTags).toHaveBeenCalledWith(path.join(root, 'one.mp3'), {
      artists: ['Corrected', 'Correct'],
    });
    expect(catalog.detail(id)?.artists).toEqual(['Corrected', 'Correct']);
    expect(catalog.tag('artist', source.id)).toBeUndefined();
    expect(catalog.tag('artist', result.destinationId)?.name).toBe('Corrected');
  });

  it('merges into an existing artist once and leaves failed songs under the source', () => {
    const first = addSong('first.flac');
    const second = addSong('second.m4a', { ...initial, artists: ['Mispeled'] });
    const source = catalog
      .tags('artist')
      .find(({ name }) => name === 'Mispeled')!;
    const destination = catalog
      .tags('artist')
      .find(({ name }) => name === 'Correct')!;
    writeTags.mockImplementation((filePath, changes) => {
      if (filePath.endsWith('second.m4a')) throw new Error('File is locked.');
      return { ...initial, ...changes };
    });
    const result = createMusicTagManager(catalog, writeTags).move(
      'artist',
      source.id,
      'Correct',
    );
    expect(result).toMatchObject({
      destinationId: destination.id,
      updated: 1,
      remaining: 1,
      errors: [{ trackId: second, message: 'File is locked.' }],
    });
    expect(catalog.detail(first)?.artists).toEqual(['Correct']);
    expect(catalog.detail(second)?.artists).toEqual(['Mispeled']);
    expect(catalog.tag('artist', source.id)).toBeDefined();
    expect(catalog.tagSongs('artist', destination.id).total).toBe(1);
  });

  it('merges genres without duplicating a genre already on the song', () => {
    const id = addSong('genre.flac', {
      ...initial,
      genres: ['DwnTempo', 'Downtempo'],
    });
    const source = catalog
      .tags('genre')
      .find(({ name }) => name === 'DwnTempo')!;
    const destination = catalog
      .tags('genre')
      .find(({ name }) => name === 'Downtempo')!;
    writeTags.mockImplementation((_filePath, changes) => ({
      ...initial,
      genres: changes.genres ?? initial.genres,
    }));

    const result = createMusicTagManager(catalog, writeTags).move(
      'genre',
      source.id,
      destination.name,
    );

    expect(result).toMatchObject({
      destinationId: destination.id,
      updated: 1,
      remaining: 0,
    });
    expect(writeTags).toHaveBeenCalledWith(path.join(root, 'genre.flac'), {
      genres: ['Downtempo'],
    });
    expect(catalog.detail(id)?.genres).toEqual(['Downtempo']);
    expect(catalog.tag('genre', source.id)).toBeUndefined();
  });

  it('renames empty tags without writing files and rejects a stale source file', () => {
    const empty = catalog.addTag('genre', 'Incorrect');
    expect(
      createMusicTagManager(catalog, writeTags).move(
        'genre',
        empty.id,
        'Correct',
      ),
    ).toMatchObject({
      destinationId: empty.id,
      updated: 0,
      remaining: 0,
    });
    expect(writeTags).not.toHaveBeenCalled();
    const id = addSong('stale.mp3', { ...initial, genres: ['Correct'] });
    const filePath = path.join(root, 'stale.mp3');
    fs.appendFileSync(filePath, 'changed outside the catalog');
    const result = createMusicTagManager(catalog, writeTags).move(
      'genre',
      empty.id,
      'New',
    );
    expect(result).toMatchObject({
      updated: 0,
      remaining: 1,
      errors: [
        {
          trackId: id,
          message: 'Track changed on disk. Rescan before editing.',
        },
      ],
    });
    expect(writeTags).not.toHaveBeenCalled();
  });
});
