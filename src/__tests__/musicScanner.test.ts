import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  createMusicCatalog,
  initializeMusicCatalog,
} from '../main/musicCatalog';
import { scanMusicRoot } from '../main/musicScanner';
import { readMusicTags } from '../main/musicTags';

jest.mock('../main/musicTags', () => ({ readMusicTags: jest.fn() }));

describe('music folder scanning', () => {
  let database: DatabaseSync;
  let root: string;
  const readTags = readMusicTags as jest.Mock;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-scan-'));
    database = new DatabaseSync(':memory:');
    const schema = fs.readFileSync(
      path.resolve(__dirname, '../../data/music/001_initial.sql'),
      'utf8',
    );
    initializeMusicCatalog(
      database as unknown as Parameters<typeof initializeMusicCatalog>[0],
      schema,
    );
    readTags.mockReset().mockReturnValue({
      title: 'Sample',
      artists: ['Artist'],
      album: 'Album',
      genres: ['Dance'],
      year: 2024,
      track: 1,
      durationMs: 1000,
    });
  });

  afterEach(() => {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('indexes supported files in place, skips unchanged files and keeps missing records', async () => {
    const catalog = createMusicCatalog(
      database as unknown as Parameters<typeof createMusicCatalog>[0],
    );
    fs.mkdirSync(path.join(root, 'nested'));
    const song = path.join(root, 'nested', 'song.MP3');
    fs.writeFileSync(song, 'test audio');
    fs.writeFileSync(path.join(root, 'ignore.txt'), 'not audio');

    expect(await scanMusicRoot(catalog, root)).toMatchObject({
      addedOrUpdated: 1,
      failed: 0,
      missing: 0,
      errors: [],
    });
    expect(await scanMusicRoot(catalog, root)).toMatchObject({
      addedOrUpdated: 0,
      unchanged: 1,
    });
    expect(readTags).toHaveBeenCalledTimes(1);
    fs.rmSync(song);
    expect(await scanMusicRoot(catalog, root)).toMatchObject({ missing: 1 });
    expect(catalog.search('Sample').rows).toMatchObject([
      { status: 'missing' },
    ]);
  });

  it('does not mark tracks missing after cancellation', async () => {
    const catalog = createMusicCatalog(
      database as unknown as Parameters<typeof createMusicCatalog>[0],
    );
    const song = path.join(root, 'song.flac');
    fs.writeFileSync(song, 'test audio');
    await scanMusicRoot(catalog, root);
    fs.rmSync(song);
    const abort = new AbortController();
    abort.abort();
    expect(await scanMusicRoot(catalog, root, abort.signal)).toMatchObject({
      cancelled: true,
      missing: 0,
    });
    expect(catalog.search('Sample').rows).toMatchObject([
      { status: 'present' },
    ]);
  });
});
