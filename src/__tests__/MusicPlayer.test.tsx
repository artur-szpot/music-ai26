import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import MusicPlayer from '../renderer/MusicPlayer';
import type { MusicBridge, MusicResult } from '../constants/musicIpc';
import type { TrackSummary } from '../main/musicCatalog';

const track: TrackSummary = {
  id: 3,
  path: 'C:\\Music\\song.mp3',
  title: 'Song',
  album: '',
  rating: 7,
  duration_ms: 120000,
  status: 'present',
  metadata_incomplete: 0,
};

describe('music player', () => {
  let playbackSource: jest.Mock;
  let onPlayingTrackChange: jest.Mock;
  beforeEach(() => {
    onPlayingTrackChange = jest.fn();
    playbackSource = jest.fn().mockResolvedValue({
      ok: true,
      data: { url: 'music-audio://track/first' },
    });
    const bridge: MusicBridge = {
      exportFiles: jest.fn(),
      onExportProgress: jest.fn(),
      playbackSource,
      roots: jest.fn(),
      chooseRoot: jest.fn(),
      scan: jest.fn(),
      cancelScan: jest.fn(),
      search: jest.fn(),
      detail: jest.fn(),
      edit: jest.fn(),
      tags: jest.fn(),
      tagSongs: jest.fn(),
      addTag: jest.fn(),
      moveTag: jest.fn(),
      randomTrack: jest.fn(),
      playlists: jest.fn(),
      createPlaylist: jest.fn(),
      renamePlaylist: jest.fn(),
      deletePlaylist: jest.fn(),
      playlistTracks: jest.fn(),
      trackPlaylists: jest.fn(),
      addPlaylistTrack: jest.fn(),
      removePlaylistTrack: jest.fn(),
      movePlaylistTrack: jest.fn(),
      createCompletionistPlaylist: jest.fn(),
      filterTracks: jest.fn(),
      createFilteredPlaylist: jest.fn(),
      playbackState: jest.fn(),
      savePlaybackState: jest.fn().mockResolvedValue({
        ok: true,
        data: undefined,
      }),
    };
    window.music = bridge;
    jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    jest
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(function pause(this: HTMLMediaElement) {
        this.dispatchEvent(new Event('pause'));
      });
    jest
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(async function play(this: HTMLMediaElement) {
        this.dispatchEvent(new Event('play'));
      });
  });
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it('starts, pauses, resumes, seeks, sets volume, stops and handles ending', async () => {
    const { container } = render(
      <MusicPlayer
        request={{ track, sequence: 1 }}
        initialVolume={1}
        onPlayingTrackChange={onPlayingTrackChange}
        onRandomTrack={undefined}
      />,
    );
    const audio = container.querySelector('audio')!;
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeEnabled();
    expect(playbackSource).toHaveBeenCalledWith(3);
    expect(onPlayingTrackChange).toHaveBeenCalledWith(3);
    expect(audio.src).toBe('music-audio://track/first');
    Object.defineProperty(audio, 'duration', {
      configurable: true,
      value: 120,
    });
    fireEvent.durationChange(audio);
    fireEvent.change(
      screen.getByRole('slider', { name: 'Playback progress' }),
      { target: { value: '45' } },
    );
    expect(audio.currentTime).toBe(45);
    audio.currentTime = 50;
    fireEvent.timeUpdate(audio);
    expect(
      screen.getByRole('slider', { name: 'Playback progress' }),
    ).toHaveValue('50');
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), {
      target: { value: '0.3' },
    });
    expect(audio.volume).toBe(0.3);
    expect(window.music.savePlaybackState).toHaveBeenCalledWith({
      trackId: 3,
      positionSeconds: 50,
      volume: 0.3,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await screen.findByRole('button', { name: 'Pause' });
    expect(playbackSource).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(audio.currentTime).toBe(0);
    expect(
      screen.getByRole('slider', { name: 'Playback progress' }),
    ).toHaveValue('0');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await screen.findByRole('button', { name: 'Pause' });
    fireEvent.ended(audio);
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
  });

  it('keeps playback disabled before choosing a track', () => {
    render(
      <MusicPlayer
        request={null}
        initialVolume={1}
        onPlayingTrackChange={onPlayingTrackChange}
        onRandomTrack={undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
    expect(
      screen.getByRole('slider', { name: 'Playback progress' }),
    ).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeEnabled();
  });

  it('continuously plays random tracks until the mode is turned off', async () => {
    const nextTrack = { ...track, id: 4, title: 'Next song' };
    const onRandomTrack = jest
      .fn<Promise<TrackSummary | null>, []>()
      .mockResolvedValueOnce(track)
      .mockResolvedValueOnce(nextTrack);
    const { container } = render(
      <MusicPlayer
        request={null}
        initialVolume={1}
        onPlayingTrackChange={onPlayingTrackChange}
        onRandomTrack={onRandomTrack}
      />,
    );
    const audio = container.querySelector('audio')!;
    const continuousRandom = screen.getByRole('button', {
      name: 'Continuous random',
    });

    fireEvent.click(continuousRandom);
    expect(continuousRandom).toHaveAttribute('aria-pressed', 'true');
    await screen.findByRole('button', { name: 'Pause' });
    expect(onRandomTrack).toHaveBeenCalledTimes(1);

    fireEvent.ended(audio);
    await waitFor(() =>
      expect(playbackSource).toHaveBeenLastCalledWith(nextTrack.id),
    );
    expect(onRandomTrack).toHaveBeenCalledTimes(2);
    await screen.findByText('Next song');
    expect(
      screen.getByRole('region', { name: 'Music player' }),
    ).toHaveTextContent('Next song');

    fireEvent.click(continuousRandom);
    expect(continuousRandom).toHaveAttribute('aria-pressed', 'false');
    fireEvent.ended(audio);
    expect(onRandomTrack).toHaveBeenCalledTimes(2);
  });

  it('reports IPC and decoding errors', async () => {
    playbackSource.mockResolvedValue({
      ok: false,
      error: { code: 'FAILED', message: 'Track is unavailable.' },
    });
    render(
      <MusicPlayer
        request={{ track, sequence: 1 }}
        initialVolume={1}
        onPlayingTrackChange={onPlayingTrackChange}
        onRandomTrack={undefined}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Track is unavailable.',
    );
    expect(onPlayingTrackChange).not.toHaveBeenCalled();
    cleanup();
    playbackSource.mockResolvedValue({
      ok: true,
      data: { url: 'music-audio://track/decoding-error' },
    });
    const { container } = render(
      <MusicPlayer
        request={{ track, sequence: 2 }}
        initialVolume={1}
        onPlayingTrackChange={onPlayingTrackChange}
        onRandomTrack={undefined}
      />,
    );
    await screen.findByRole('button', { name: 'Pause' });
    fireEvent.error(container.querySelector('audio')!);
    expect(screen.getByRole('alert')).toHaveTextContent('supported codec');
  });

  it('reports a rejected play request', async () => {
    jest
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValue(new Error('Playback denied.'));
    render(
      <MusicPlayer
        request={{ track, sequence: 1 }}
        initialVolume={1}
        onPlayingTrackChange={onPlayingTrackChange}
        onRandomTrack={undefined}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Playback denied.',
    );
    expect(onPlayingTrackChange).not.toHaveBeenCalled();
  });

  it('skips missing tracks in a playlist and advances in order', async () => {
    const missingTrack = {
      ...track,
      id: 8,
      title: 'Missing',
      status: 'missing' as const,
    };
    const followingTrack = { ...track, id: 4, title: 'Following' };
    render(
      <MusicPlayer
        request={{
          track: missingTrack,
          queue: [missingTrack, followingTrack],
          sequence: 1,
        }}
        initialVolume={1}
        onPlayingTrackChange={onPlayingTrackChange}
        onRandomTrack={undefined}
      />,
    );
    await waitFor(() =>
      expect(playbackSource).toHaveBeenCalledWith(followingTrack.id),
    );
    expect(playbackSource).not.toHaveBeenCalledWith(missingTrack.id);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Skipped 1 unavailable playlist track.',
    );
    expect(screen.getByText('Following')).toBeInTheDocument();
    await waitFor(() =>
      expect(onPlayingTrackChange).toHaveBeenCalledWith(followingTrack.id),
    );
    expect(onPlayingTrackChange).not.toHaveBeenCalledWith(missingTrack.id);
  });

  it('ignores an older source response when another track starts', async () => {
    let resolveFirst!: (value: MusicResult<{ url: string }>) => void;
    playbackSource.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { container, rerender } = render(
      <MusicPlayer
        request={{ track, sequence: 1 }}
        initialVolume={1}
        onPlayingTrackChange={onPlayingTrackChange}
        onRandomTrack={undefined}
      />,
    );
    rerender(
      <MusicPlayer
        request={{ track: { ...track, id: 4, title: 'Second' }, sequence: 2 }}
        initialVolume={1}
        onPlayingTrackChange={onPlayingTrackChange}
        onRandomTrack={undefined}
      />,
    );
    await screen.findByRole('button', { name: 'Pause' });
    await act(async () =>
      resolveFirst({ ok: true, data: { url: 'music-audio://track/stale' } }),
    );
    expect(container.querySelector('audio')!.src).toBe(
      'music-audio://track/first',
    );
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(onPlayingTrackChange).toHaveBeenCalledWith(4);
    expect(onPlayingTrackChange).not.toHaveBeenCalledWith(3);
  });

  it('cancels a pending start when stopped and preserves volume across tracks', async () => {
    let resolveSource!: (value: MusicResult<{ url: string }>) => void;
    playbackSource.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSource = resolve;
        }),
    );
    const { container, rerender } = render(
      <MusicPlayer
        request={{ track, sequence: 1 }}
        initialVolume={1}
        onPlayingTrackChange={onPlayingTrackChange}
        onRandomTrack={undefined}
      />,
    );
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), {
      target: { value: '0.2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await act(async () =>
      resolveSource({ ok: true, data: { url: 'music-audio://track/stopped' } }),
    );
    expect(container.querySelector('audio')).not.toHaveAttribute('src');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    rerender(
      <MusicPlayer
        request={{ track, sequence: 2 }}
        initialVolume={1}
        onPlayingTrackChange={onPlayingTrackChange}
        onRandomTrack={undefined}
      />,
    );
    await waitFor(() =>
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1),
    );
    expect(container.querySelector('audio')!.volume).toBe(0.2);
  });
});
