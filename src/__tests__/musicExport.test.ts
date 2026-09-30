/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  createMusicCatalog,
  initializeMusicCatalog,
} from '../main/musicCatalog';
import { collectExportTracks, copyExportTracks } from '../main/musicExport';
import type { MusicExportProgress } from '../constants/musicIpc';

describe('music file export', () => {
  let directory: string;
  let root: string;
  let destination: string;
  let database: DatabaseSync;
  let catalog: ReturnType<typeof createMusicCatalog>;
  let sourceId: number;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-export-'));
    root = path.join(directory, 'source');
    destination = path.join(directory, 'export');
    fs.mkdirSync(root);
    fs.mkdirSync(destination);
    database = new DatabaseSync(':memory:');
    const connection = database as unknown as Parameters<
      typeof createMusicCatalog
    >[0];
    initializeMusicCatalog(
      connection,
      fs.readFileSync(
        path.resolve(__dirname, '../../data/music/001_initial.sql'),
        'utf8',
      ),
    );
    catalog = createMusicCatalog(connection);
    sourceId = catalog.addRoot(root);
  });

  afterEach(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function addTrack(fileName: string, rating = 7, title = 'Dance'): number {
    const filePath = path.join(root, fileName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `audio: ${fileName}`);
    return catalog.upsertTrack({
      sourceId,
      filePath,
      sizeBytes: fs.statSync(filePath).size,
      mtimeMs: fs.statSync(filePath).mtimeMs,
      tags: {
        title,
        rating,
        artists: ['Artist'],
        genres: ['Genre'],
        album: '',
        year: 0,
        track: 0,
        durationMs: 1000,
        isDad: null,
        isMlp: null,
      },
    });
  }

  it('exports every playlist track, preserves bytes and leaves sources/catalog unchanged', async () => {
    const playlist = catalog.createPlaylist('Mix');
    for (let index = 0; index < 121; index += 1) {
      catalog.addPlaylistTrack(playlist.id, addTrack(`song-${index}.mp3`));
    }
    addTrack('not-in-playlist.flac', 10);
    const tracks = collectExportTracks(catalog, {
      kind: 'playlist',
      id: playlist.id,
    });
    expect(tracks).toHaveLength(121);
    const progress: MusicExportProgress[] = [];
    const result = await copyExportTracks(
      catalog,
      tracks,
      destination,
      (update) => progress.push(update),
    );
    expect(result).toMatchObject({
      total: 121,
      completed: 121,
      copied: 121,
      failed: 0,
      errors: [],
    });
    expect(fs.readdirSync(destination)).toHaveLength(121);
    tracks.forEach((track) => {
      expect(
        fs.readFileSync(path.join(destination, path.basename(track.path))),
      ).toEqual(fs.readFileSync(track.path));
      expect(catalog.detail(track.id)?.status).toBe('present');
    });
    expect(progress[0]).toMatchObject({ completed: 0, total: 121 });
    expect(progress.at(-1)).toMatchObject({ completed: 121, copied: 121 });
    expect(
      progress.every(
        (update, index) =>
          index === 0 || update.completed >= progress[index - 1].completed,
      ),
    ).toBe(true);
  });

  it('uses playlist membership and order rather than the whole library', () => {
    const first = addTrack('first.mp3');
    const second = addTrack('second.flac');
    addTrack('excluded.m4a');
    const playlist = catalog.createPlaylist('Mix');
    catalog.addPlaylistTrack(playlist.id, second);
    catalog.addPlaylistTrack(playlist.id, first);
    expect(
      collectExportTracks(catalog, { kind: 'playlist', id: playlist.id }).map(
        ({ id }) => id,
      ),
    ).toEqual([second, first]);
  });

  it('keeps both duplicate and existing names, including hard-link destinations', async () => {
    addTrack('one/song.mp3');
    addTrack('two/song.mp3');
    fs.writeFileSync(path.join(destination, 'song.mp3'), 'existing');
    fs.writeFileSync(path.join(directory, 'outside.mp3'), 'outside');
    fs.linkSync(
      path.join(directory, 'outside.mp3'),
      path.join(destination, 'song (2).mp3'),
    );
    const result = await copyExportTracks(
      catalog,
      catalog.search('').rows,
      destination,
      () => {},
    );
    expect(result).toMatchObject({ copied: 2, failed: 0 });
    expect(fs.readFileSync(path.join(destination, 'song.mp3'), 'utf8')).toBe(
      'existing',
    );
    expect(fs.readFileSync(path.join(directory, 'outside.mp3'), 'utf8')).toBe(
      'outside',
    );
    expect(
      fs.readFileSync(path.join(destination, 'song (3).mp3'), 'utf8'),
    ).toBe('audio: one/song.mp3');
    expect(
      fs.readFileSync(path.join(destination, 'song (4).mp3'), 'utf8'),
    ).toBe('audio: two/song.mp3');
  });

  it('reports unavailable files and still copies remaining tracks', async () => {
    addTrack('gone.mp3');
    addTrack('good.flac');
    fs.rmSync(path.join(root, 'gone.mp3'));
    const result = await copyExportTracks(
      catalog,
      catalog.search('').rows,
      destination,
      () => {},
    );
    expect(result).toMatchObject({
      total: 2,
      completed: 2,
      copied: 1,
      failed: 1,
    });
    expect(result.errors[0].fileName).toBe(path.join(root, 'gone.mp3'));
    expect(fs.readFileSync(path.join(destination, 'good.flac'), 'utf8')).toBe(
      'audio: good.flac',
    );
  });

  it('does not follow source junctions outside a chosen root', async () => {
    addTrack('linked/song.mp3');
    fs.unlinkSync(path.join(root, 'linked', 'song.mp3'));
    fs.rmdirSync(path.join(root, 'linked'));
    const outside = path.join(directory, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'song.mp3'), 'private');
    fs.symlinkSync(outside, path.join(root, 'linked'), 'junction');
    const result = await copyExportTracks(
      catalog,
      catalog.search('').rows,
      destination,
      () => {},
    );
    expect(result).toMatchObject({ copied: 0, failed: 1 });
    expect(result.errors[0].message).toBe('Track is outside its source root.');
    expect(fs.readdirSync(destination)).toEqual([]);
  });

  it('reports missing records and offline roots without changing the catalog', async () => {
    const id = addTrack('missing.mp3');
    catalog.markAbsent(sourceId, new Set());
    const missing = await copyExportTracks(
      catalog,
      catalog.search('').rows,
      destination,
      () => {},
    );
    expect(missing.errors[0].message).toBe('Track is unavailable.');
    expect(catalog.detail(id)?.status).toBe('missing');
    addTrack('missing.mp3');
    fs.renameSync(root, path.join(directory, 'offline'));
    const offline = await copyExportTracks(
      catalog,
      catalog.search('').rows,
      destination,
      () => {},
    );
    expect(offline).toMatchObject({ copied: 0, failed: 1 });
    expect(catalog.detail(id)?.status).toBe('present');
  });

  it('rejects an unavailable destination before copying', async () => {
    addTrack('song.mp3');
    await expect(
      copyExportTracks(
        catalog,
        catalog.search('').rows,
        path.join(directory, 'absent'),
        () => {},
      ),
    ).rejects.toThrow();
    expect(fs.readdirSync(root)).toEqual(['song.mp3']);
  });
});
