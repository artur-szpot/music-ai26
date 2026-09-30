import path from 'node:path';
import { File } from 'node-taglib-sharp';

export type MusicTags = {
  title: string;
  artists: string[];
  album: string;
  genres: string[];
  year: number;
  track: number;
  durationMs: number;
};

export type MusicTagEdit = Partial<Omit<MusicTags, 'durationMs'>>;

const supportedExtensions = new Set(['.mp3', '.flac', '.m4a']);

function checkFormat(filePath: string): void {
  if (!supportedExtensions.has(path.extname(filePath).toLowerCase())) {
    throw new Error('Only MP3, FLAC, and M4A files are supported.');
  }
}

export function readMusicTags(filePath: string): MusicTags {
  checkFormat(filePath);
  const file = File.createFromPath(filePath);
  try {
    if (file.isPossiblyCorrupt) {
      throw new Error('The audio file may be corrupt.');
    }
    return {
      title: file.tag.title || '',
      artists: [...(file.tag.performers || [])],
      album: file.tag.album || '',
      genres: [...(file.tag.genres || [])],
      year: file.tag.year || 0,
      track: file.tag.track || 0,
      durationMs: file.properties.durationMilliseconds || 0,
    };
  } finally {
    file.dispose();
  }
}

export function writeMusicTags(
  filePath: string,
  changes: MusicTagEdit,
): MusicTags {
  checkFormat(filePath);
  if (Object.keys(changes).length === 0) {
    throw new Error('No tag changes were provided.');
  }
  const file = File.createFromPath(filePath);
  try {
    if (file.isPossiblyCorrupt || !file.isWritable) {
      throw new Error('The audio file is corrupt or cannot be written.');
    }
    if (changes.title !== undefined) file.tag.title = changes.title;
    if (changes.artists !== undefined) file.tag.performers = changes.artists;
    if (changes.album !== undefined) file.tag.album = changes.album;
    if (changes.genres !== undefined) file.tag.genres = changes.genres;
    if (changes.year !== undefined) file.tag.year = changes.year;
    if (changes.track !== undefined) file.tag.track = changes.track;
    file.save();
  } finally {
    file.dispose();
  }

  const saved = readMusicTags(filePath);
  Object.entries(changes).forEach(([field, value]) => {
    if (
      JSON.stringify(saved[field as keyof MusicTagEdit]) !==
      JSON.stringify(value)
    ) {
      throw new Error(`Could not verify the saved ${field} tag.`);
    }
  });
  return saved;
}
