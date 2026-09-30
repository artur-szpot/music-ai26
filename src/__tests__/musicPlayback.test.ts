/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  createMusicCatalog,
  initializeMusicCatalog,
} from '../main/musicCatalog';
import { createMusicPlayback } from '../main/musicPlayback';

describe('file-backed playback access', () => {
  let root: string;
  let database: DatabaseSync;
  let catalog: ReturnType<typeof createMusicCatalog>;
  let id: number;
  let filePath: string;
  const fetchFile = jest.fn<Promise<Response>, [string, Request]>(
    async () => new Response('audio', { status: 200 }),
  );

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'music-playback-')),
    );
    filePath = path.join(root, 'song #1.mp3');
    fs.writeFileSync(filePath, 'disposable audio');
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
    id = catalog.upsertTrack({
      sourceId: catalog.addRoot(root),
      filePath,
      sizeBytes: 16,
      mtimeMs: 1,
      tags: {
        title: 'Song',
        artists: ['Artist'],
        genres: ['Genre'],
        album: '',
        rating: 7,
        year: 0,
        track: 0,
        durationMs: 1000,
      },
    });
    fetchFile.mockClear();
  });
  afterEach(() => {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('grants only a catalog ID and forwards range requests using an encoded file URL', async () => {
    const playback = createMusicPlayback(catalog, fetchFile);
    const { url } = playback.source(id);
    expect(url).toMatch(/^music-audio:\/\/track\/[a-f0-9-]+$/);
    expect(url).not.toContain('song');
    const request = new Request(url, { headers: { Range: 'bytes=2-5' } });
    expect((await playback.serve(request)).status).toBe(206);
    expect(fetchFile).toHaveBeenCalledWith(
      pathToFileURL(filePath).href,
      expect.any(Request),
    );
    expect(fetchFile.mock.calls[0][1].headers.get('Range')).toBe('bytes=2-5');
  });

  it('denies unknown tokens, paths, methods, expired grants and invalid IDs', async () => {
    const playback = createMusicPlayback(catalog, fetchFile);
    const { url } = playback.source(id);
    expect(() => playback.source(0)).toThrow('Invalid track ID');
    expect(() => playback.source(999)).toThrow('unavailable');
    expect(
      (await playback.serve(new Request('music-audio://track/unknown'))).status,
    ).toBe(403);
    expect((await playback.serve(new Request(`${url}/song.mp3`))).status).toBe(
      403,
    );
    expect(
      (await playback.serve(new Request(url, { method: 'POST' }))).status,
    ).toBe(403);
    playback.source(id);
    expect((await playback.serve(new Request(url))).status).toBe(403);
    const fresh = playback.source(id).url;
    playback.clear();
    expect((await playback.serve(new Request(fresh))).status).toBe(403);
    expect(fetchFile).not.toHaveBeenCalled();
  });

  it('refuses missing files and tracks marked missing', () => {
    const playback = createMusicPlayback(catalog, fetchFile);
    fs.rmSync(filePath);
    expect(() => playback.source(id)).toThrow();
    catalog.markAbsent(1, new Set());
    expect(() => playback.source(id)).toThrow('unavailable');
  });

  it.each([
    ['bytes=2-5', 'bytes 2-5/16', '4', 'bytes=2-5'],
    ['bytes=8-', 'bytes 8-15/16', '8', 'bytes=8-15'],
    ['bytes=-4', 'bytes 12-15/16', '4', 'bytes=12-15'],
    ['bytes=10-99', 'bytes 10-15/16', '6', 'bytes=10-15'],
  ])(
    'normalizes %s into a seekable partial response',
    async (range, expected, length, forwarded) => {
      const playback = createMusicPlayback(catalog, fetchFile);
      const response = await playback.serve(
        new Request(playback.source(id).url, {
          headers: { Range: range },
        }),
      );
      expect(response.status).toBe(206);
      expect(response.headers.get('Content-Range')).toBe(expected);
      expect(response.headers.get('Content-Length')).toBe(length);
      expect(response.headers.get('Accept-Ranges')).toBe('bytes');
      expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
      expect(fetchFile.mock.calls[0][1].headers.get('Range')).toBe(forwarded);
    },
  );

  it.each([
    'bytes=16-',
    'bytes=5-2',
    'bytes=-0',
    'bytes=-',
    'bytes=1-2,4-5',
    'bytes=-999999999999999999999',
    'invalid',
  ])('rejects invalid range %s without reading the file', async (range) => {
    const playback = createMusicPlayback(catalog, fetchFile);
    const response = await playback.serve(
      new Request(playback.source(id).url, {
        headers: { Range: range },
      }),
    );
    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe('bytes */16');
    expect(fetchFile).not.toHaveBeenCalled();
  });

  it('serves HEAD metadata without loading audio', async () => {
    const playback = createMusicPlayback(catalog, fetchFile);
    const response = await playback.serve(
      new Request(playback.source(id).url, { method: 'HEAD' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe('16');
    expect(response.body).toBeNull();
    expect(fetchFile).not.toHaveBeenCalled();
  });

  it('revalidates granted files and reports errors rather than serving outside a root', async () => {
    const playback = createMusicPlayback(catalog, fetchFile);
    const { url } = playback.source(id);
    const differentRoot = path.join(root, 'different-root');
    fs.mkdirSync(differentRoot);
    const differentSource = catalog.addRoot(differentRoot);
    database
      .prepare('UPDATE tracks SET source_id = ? WHERE id = ?')
      .run(differentSource, id);
    const stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    const response = await playback.serve(new Request(url));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Track is outside its source root.');
    expect(stderr).toHaveBeenCalled();
    expect(fetchFile).not.toHaveBeenCalled();
    stderr.mockRestore();
  });
});
