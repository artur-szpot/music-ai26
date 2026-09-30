import { File } from 'node-taglib-sharp';
import { readMusicTags, writeMusicTags } from '../main/musicTags';

jest.mock('node-taglib-sharp', () => ({
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

  beforeEach(() => {
    dispose = jest.fn();
    save = jest.fn();
    createFromPath.mockReset().mockImplementation(() => ({
      tag: tags,
      properties: { durationMilliseconds: 120000 },
      isPossiblyCorrupt: false,
      isWritable: true,
      dispose,
      save,
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
      });
      expect(dispose).toHaveBeenCalledTimes(1);
    },
  );

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
    }));
    expect(() => writeMusicTags('song.m4a', { title: 'Updated' })).toThrow(
      'Could not verify the saved title tag',
    );
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
