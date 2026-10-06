/** @jest-environment node */
import {
  File,
  Id3v2PopularimeterFrame,
  Id3v2Tag,
  Mpeg4AppleTag,
  Mpeg4IsoUserDataBox,
  TagTypes,
  XiphComment,
} from 'node-taglib-sharp';
import { readMusicTags, writeMusicTags } from '../main/musicTags';

jest.mock('node-taglib-sharp', () => ({
  ...jest.requireActual('node-taglib-sharp'),
  File: { createFromPath: jest.fn() },
}));

describe('music tags', () => {
  const createFromPath = File.createFromPath as jest.Mock;
  const tags = {
    title: 'Original',
    performers: ['Artist A', 'Artist B'],
    album: 'Collection',
    genres: ['Electronic'],
    year: 2020,
    track: 2,
  };
  let dispose: jest.Mock;
  let save: jest.Mock;
  let getTag: jest.Mock;

  beforeEach(() => {
    dispose = jest.fn();
    save = jest.fn();
    getTag = jest.fn();
    createFromPath.mockReset().mockImplementation(() => ({
      tag: tags,
      properties: { durationMilliseconds: 120000 },
      isPossiblyCorrupt: false,
      isWritable: true,
      dispose,
      save,
      getTag,
    }));
    tags.title = 'Original';
    tags.performers = ['Artist A', 'Artist B'];
  });

  it.each(['song.mp3', 'song.FLAC', 'song.m4a'])(
    'reads supported format %s and disposes the file',
    (filePath) => {
      expect(readMusicTags(filePath)).toEqual({
        title: 'Original',
        artists: ['Artist A', 'Artist B'],
        album: 'Collection',
        genres: ['Electronic'],
        year: 2020,
        track: 2,
        durationMs: 120000,
        rating: null,
      });
      expect(dispose).toHaveBeenCalledTimes(1);
    },
  );

  it.each<[number, number | null]>([
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
    [100, null],
  ])('maps MP3 POPM %s to %s stars', (raw, expected) => {
    const id3 = Id3v2Tag.fromEmpty();
    const frame = Id3v2PopularimeterFrame.fromUser('no@email');
    frame.rating = raw;
    id3.addFrame(frame);
    getTag.mockImplementation((type) =>
      type === TagTypes.Id3v2 ? id3 : undefined,
    );
    expect(readMusicTags('song.mp3').rating).toBe(expected);
  });

  it('prefers the previous app rating owner over other POPM frames', () => {
    const id3 = Id3v2Tag.fromEmpty();
    const other = Id3v2PopularimeterFrame.fromUser('another@example.com');
    other.rating = 255;
    id3.addFrame(other);
    getTag.mockReturnValue(id3);
    expect(readMusicTags('song.mp3').rating).toBe(10);
    const legacy = Id3v2PopularimeterFrame.fromUser('no@email');
    legacy.rating = 186;
    id3.addFrame(legacy);
    expect(readMusicTags('song.mp3').rating).toBe(7);
  });

  it.each([
    ['FMPS_RATING', '0.7', 7],
    ['RATING', '80', 8],
    ['RATING', '0', 0],
    ['RATING', '101', null],
    ['RATING', 'invalid', null],
    ['RATING', '', null],
  ])('reads FLAC %s=%s as %s stars', (field, value, expected) => {
    const xiph = XiphComment.fromEmpty();
    xiph.setFieldAsStrings(field, value);
    getTag.mockImplementation((type) =>
      type === TagTypes.Xiph ? xiph : undefined,
    );
    expect(readMusicTags('song.flac').rating).toBe(expected);
  });

  it('reads M4A custom rating tags', () => {
    const apple = new Mpeg4AppleTag(Mpeg4IsoUserDataBox.fromEmpty());
    apple.setItunesStrings('com.apple.iTunes', 'RATING', '90');
    getTag.mockImplementation((type) =>
      type === TagTypes.Apple ? apple : undefined,
    );
    expect(readMusicTags('song.m4a').rating).toBe(9);
    apple.setItunesStrings('com.apple.iTunes', 'FMPS_RATING', '0.4');
    expect(readMusicTags('song.m4a').rating).toBe(4);
  });

  it('saves only changed fields and verifies them by rereading', () => {
    const result = writeMusicTags('song.flac', {
      title: 'Updated',
      artists: ['Artist A', 'Artist B'],
    });
    expect(result.title).toBe('Updated');
    expect(result.album).toBe('Collection');
    expect(save).toHaveBeenCalledTimes(1);
    expect(createFromPath).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('rejects unsupported formats and empty edits without opening a file', () => {
    expect(() => readMusicTags('song.wav')).toThrow('Only MP3, FLAC, and M4A');
    expect(() => writeMusicTags('song.mp3', {})).toThrow('No tag changes');
    expect(createFromPath).not.toHaveBeenCalled();
  });

  it('refuses to save a potentially corrupt or unwritable file', () => {
    createFromPath.mockImplementationOnce(() => ({
      tag: tags,
      isPossiblyCorrupt: true,
      isWritable: true,
      dispose,
      save,
      getTag,
    }));
    expect(() => writeMusicTags('song.mp3', { title: 'Updated' })).toThrow(
      'corrupt or cannot be written',
    );
    expect(save).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('reports a tag that did not survive saving', () => {
    createFromPath.mockImplementationOnce(() => ({
      tag: { ...tags },
      isPossiblyCorrupt: false,
      isWritable: true,
      dispose,
      save,
      getTag,
    }));
    expect(() => writeMusicTags('song.m4a', { title: 'Updated' })).toThrow(
      'Could not verify the saved title tag',
    );
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
