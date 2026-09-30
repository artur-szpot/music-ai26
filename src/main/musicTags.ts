import path from 'node:path';
import {
  File,
  Id3v2CommentsFrame,
  Id3v2FrameClassType,
  Id3v2PopularimeterFrame,
  Id3v2Tag,
  Mpeg4AppleTag,
  TagTypes,
  XiphComment,
} from 'node-taglib-sharp';

export type MusicTags = {
  title: string;
  artists: string[];
  album: string;
  genres: string[];
  year: number;
  track: number;
  durationMs: number;
  rating: number | null;
  isDad: boolean | null;
  isMlp: boolean | null;
};

export type MusicTagEdit = Partial<
  Omit<MusicTags, 'durationMs' | 'rating' | 'isDad' | 'isMlp'>
> & { isDad?: boolean; isMlp?: boolean };

const flagFields = {
  isDad: 'Songs-DB_Custom2',
  isMlp: 'Songs-DB_Custom3',
} as const;

function readFlag(file: File, field: string): boolean | null {
  let value: string | undefined;
  const id3 = file.getTag(TagTypes.Id3v2, false);
  if (id3 instanceof Id3v2Tag) {
    value = id3
      .getFramesByClassType<Id3v2CommentsFrame>(
        Id3v2FrameClassType.CommentsFrame,
      )
      .find(
        (frame) => frame.description === field && frame.language === 'XXX',
      )?.text;
  } else {
    const xiph = file.getTag(TagTypes.Xiph, false);
    const apple = file.getTag(TagTypes.Apple, false);
    if (xiph instanceof XiphComment) value = xiph.getField(field)[0];
    else if (apple instanceof Mpeg4AppleTag)
      value = apple.getFirstItunesString('com.apple.iTunes', field);
  }
  if (value === undefined) return null;
  return /^[+-]?\d+$/.test(value.trim()) && Number(value) !== 0;
}

function writeFlag(
  file: File,
  filePath: string,
  field: string,
  value: boolean,
): void {
  const text = value ? '1' : '0';
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.mp3') {
    const id3 = file.getTag(TagTypes.Id3v2, true);
    if (id3 instanceof Id3v2Tag) {
      const frames = id3
        .getFramesByClassType<Id3v2CommentsFrame>(
          Id3v2FrameClassType.CommentsFrame,
        )
        .filter(
          (frame) => frame.description === field && frame.language === 'XXX',
        );
      if (frames.length) frames.forEach((frame) => { frame.text = text; });
      else {
        const frame = Id3v2CommentsFrame.fromDescription(field, 'XXX');
        frame.text = text;
        id3.addFrame(frame);
      }
      return;
    }
  } else if (extension === '.flac') {
    const xiph = file.getTag(TagTypes.Xiph, true);
    if (xiph instanceof XiphComment) {
      xiph.setFieldAsStrings(field, text);
      return;
    }
  } else {
    const apple = file.getTag(TagTypes.Apple, true);
    if (apple instanceof Mpeg4AppleTag) {
      apple.setItunesStrings('com.apple.iTunes', field, text);
      return;
    }
  }
  throw new Error(`Could not write the ${field} tag.`);
}

const supportedExtensions = new Set(['.mp3', '.flac', '.m4a']);
const mp3Ratings = new Map([
  [0, 0],
  [13, 1],
  [1, 2],
  [54, 3],
  [64, 4],
  [118, 5],
  [128, 6],
  [186, 7],
  [196, 8],
  [242, 9],
  [255, 10],
]);

function scaledRating(
  value: string | undefined,
  maximum: number,
): number | null {
  if (!value?.trim()) return null;
  const rating = Number(value);
  return Number.isFinite(rating) && rating >= 0 && rating <= maximum
    ? Math.round((rating * 10) / maximum)
    : null;
}

function readRating(file: File): number | null {
  const id3 = file.getTag(TagTypes.Id3v2, false);
  if (id3 instanceof Id3v2Tag) {
    const frames = id3.getFramesByClassType<Id3v2PopularimeterFrame>(
      Id3v2FrameClassType.PopularimeterFrame,
    );
    const frame = frames.find(({ user }) => user === 'no@email') ?? frames[0];
    if (frame) return mp3Ratings.get(frame.rating) ?? null;
  }
  const xiph = file.getTag(TagTypes.Xiph, false);
  if (xiph instanceof XiphComment) {
    return (
      scaledRating(xiph.getField('FMPS_RATING')[0], 1) ??
      scaledRating(xiph.getField('RATING')[0], 100)
    );
  }
  const apple = file.getTag(TagTypes.Apple, false);
  if (apple instanceof Mpeg4AppleTag) {
    return (
      scaledRating(
        apple.getFirstItunesString('com.apple.iTunes', 'FMPS_RATING'),
        1,
      ) ??
      scaledRating(
        apple.getFirstItunesString('com.apple.iTunes', 'RATING'),
        100,
      )
    );
  }
  return null;
}

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
      rating: readRating(file),
      isDad: readFlag(file, flagFields.isDad),
      isMlp: readFlag(file, flagFields.isMlp),
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
    (Object.keys(flagFields) as (keyof typeof flagFields)[]).forEach((key) => {
      const value = changes[key];
      if (value !== undefined)
        writeFlag(file, filePath, flagFields[key], value);
    });
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
