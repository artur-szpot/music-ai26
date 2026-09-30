import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { createMusicCatalog } from './musicCatalog';
import resolveMusicFilePath from './musicFiles';

export type MusicPlayback = {
  source(id: number): { url: string };
  clear(): void;
  serve(request: Request): Promise<Response>;
};

export function createMusicPlayback(
  catalog: ReturnType<typeof createMusicCatalog>,
  fetchFile: (url: string, request: Request) => Promise<Response>,
): MusicPlayback {
  let grant: { token: string; trackId: number } | null = null;

  const resolveTrack = (id: number): string => {
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error('Invalid track ID.');
    }
    const track = catalog.detail(id);
    if (!track || track.status !== 'present') {
      throw new Error('Track is unavailable.');
    }
    const root = catalog
      .roots()
      .find(({ id: rootId }) => rootId === track.source_id);
    if (!root) throw new Error('Source root is unavailable.');
    const actualPath = resolveMusicFilePath(track.path, root.root_path);
    if (
      !['.mp3', '.flac', '.m4a'].includes(
        path.extname(actualPath).toLowerCase(),
      ) ||
      !fs.statSync(actualPath).isFile()
    ) {
      throw new Error('Track is not a supported audio file.');
    }
    return actualPath;
  };

  return {
    source(id: number): { url: string } {
      resolveTrack(id);
      grant = { token: randomUUID(), trackId: id };
      return { url: `music-audio://track/${grant.token}` };
    },
    clear(): void {
      grant = null;
    },
    async serve(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (
        !grant ||
        url.protocol !== 'music-audio:' ||
        url.hostname !== 'track' ||
        url.pathname !== `/${grant.token}` ||
        url.search ||
        url.username ||
        url.password ||
        url.port ||
        (request.method !== 'GET' && request.method !== 'HEAD')
      ) {
        return new Response('Playback request denied.', { status: 403 });
      }
      try {
        const filePath = resolveTrack(grant.trackId);
        const { size } = fs.statSync(filePath);
        const contentTypes: Record<string, string> = {
          '.mp3': 'audio/mpeg',
          '.flac': 'audio/flac',
          '.m4a': 'audio/mp4',
        };
        const headers = new Headers({
          'Accept-Ranges': 'bytes',
          'Content-Type': contentTypes[path.extname(filePath).toLowerCase()],
          'Content-Length': String(size),
        });
        const range = request.headers.get('Range');
        const fetchHeaders = new Headers();
        let status = 200;
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          let start = match?.[1] ? Number(match[1]) : 0;
          let end = match?.[2] ? Number(match[2]) : size - 1;
          if (match && !match[1] && match[2]) {
            start = Math.max(0, size - Number(match[2]));
            end = size - 1;
          }
          if (
            !match ||
            (!match[1] && !match[2]) ||
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            (match[2] && !Number.isSafeInteger(Number(match[2]))) ||
            start >= size ||
            start > end
          ) {
            return new Response('Invalid playback byte range.', {
              status: 416,
              headers: { 'Content-Range': `bytes */${size}` },
            });
          }
          end = Math.min(end, size - 1);
          headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
          headers.set('Content-Length', String(end - start + 1));
          fetchHeaders.set('Range', `bytes=${start}-${end}`);
          status = 206;
        }
        if (request.method === 'HEAD') {
          return new Response(null, { status, headers });
        }
        const response = await fetchFile(
          pathToFileURL(filePath).href,
          new Request(request.url, {
            headers: fetchHeaders,
            signal: request.signal,
          }),
        );
        if (!response.ok) throw new Error('Could not read this audio file.');
        // Chromium's file loader slices ranges but reports status 200 without Content-Range.
        return new Response(response.body, { status, headers });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Playback failed.';
        process.stderr.write(`Music playback failed: ${message}\n`);
        return new Response(message, { status: 404 });
      }
    },
  };
}
