import '@testing-library/jest-dom';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  cleanup,
  act,
} from '@testing-library/react';
import MusicApp from '../renderer/MusicApp';
import type { MusicExportProgress } from '../constants/musicIpc';
import type { TrackDetail } from '../main/musicCatalog';

describe('music collection window', () => {
  const bridge = {
    exportFiles: jest.fn(),
    onExportProgress: jest.fn(),
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
    playbackSource: jest.fn(),
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
    savePlaybackState: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    bridge.exportFiles.mockReset().mockResolvedValue({ ok: true, data: null });
    bridge.onExportProgress.mockReset().mockReturnValue(jest.fn());
    jest
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {});
    jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    jest
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(async function play(this: HTMLMediaElement) {
        this.dispatchEvent(new Event('play'));
      });
    bridge.playbackSource.mockResolvedValue({
      ok: true,
      data: { url: 'music-audio://track/test' },
    });
    bridge.randomTrack.mockResolvedValue({ ok: true, data: null });
    bridge.playlists.mockResolvedValue({ ok: true, data: [] });
    bridge.createPlaylist.mockResolvedValue({
      ok: true,
      data: {
        id: 12,
        name: 'Road Mix',
        track_count: 0,
        total_duration_ms: 0,
        average_rating: null,
      },
    });
    bridge.renamePlaylist.mockResolvedValue({
      ok: true,
      data: {
        id: 12,
        name: 'Road Mix',
        track_count: 0,
        total_duration_ms: 0,
        average_rating: null,
      },
    });
    bridge.deletePlaylist.mockResolvedValue({ ok: true, data: true });
    bridge.playlistTracks.mockResolvedValue({ ok: true, data: [] });
    bridge.trackPlaylists.mockResolvedValue({ ok: true, data: [] });
    bridge.addPlaylistTrack.mockResolvedValue({ ok: true, data: undefined });
    bridge.removePlaylistTrack.mockResolvedValue({ ok: true, data: true });
    bridge.movePlaylistTrack.mockResolvedValue({
      ok: true,
      data: undefined,
    });
    bridge.createCompletionistPlaylist.mockResolvedValue({
      ok: true,
      data: { playlist: null, tracks: [], historyReset: false },
    });
    bridge.filterTracks.mockResolvedValue({
      ok: true,
      data: { total: 0, totalDurationMs: 0, rows: [] },
    });
    bridge.createFilteredPlaylist.mockResolvedValue({
      ok: true,
      data: { playlist: null },
    });
    bridge.playbackState.mockResolvedValue({
      ok: true,
      data: { track: null, positionSeconds: 0, volume: 1 },
    });
    bridge.savePlaybackState.mockResolvedValue({ ok: true, data: undefined });
    window.music = bridge;
    bridge.roots.mockResolvedValue({ ok: true, data: [] });
    bridge.tags.mockResolvedValue({ ok: true, data: [] });
    bridge.chooseRoot.mockResolvedValue({
      ok: true,
      data: { id: 1, root_path: 'C:\\Music' },
    });
    bridge.scan.mockResolvedValue({
      ok: true,
      data: {
        addedOrUpdated: 1,
        unchanged: 0,
        missing: 0,
        failed: 0,
        cancelled: false,
        errors: [],
      },
    });
    bridge.search.mockResolvedValue({
      ok: true,
      data: {
        total: 1,
        rows: [
          {
            id: 3,
            path: 'C:\\Music\\song.mp3',
            title: 'Song',
            album: 'Album',
            duration_ms: 120000,
            status: 'present',
            metadata_incomplete: 0,
            rating: 7,
          },
        ],
      },
    });
    bridge.detail.mockResolvedValue({
      ok: true,
      data: {
        id: 3,
        source_id: 1,
        path: 'C:\\Music\\song.mp3',
        title: 'Song',
        album: 'Album',
        artists: ['Artist'],
        genres: ['Dance', 'Electronic'],
        is_dad: null,
        is_mlp: null,
        rating: 7,
        year: 2024,
        track_number: 2,
        duration_ms: 120000,
        size_bytes: 100,
        mtime_ms: 1000,
        status: 'present',
        metadata_incomplete: 0,
      },
    });
    bridge.edit.mockImplementation(async (_id, changes) => ({
      ok: true,
      data: { ...(await bridge.detail()).data, ...changes },
    }));
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it('exports the selected playlist and shows progress across views', async () => {
    let report: ((progress: MusicExportProgress) => void) | undefined;
    const unsubscribe = jest.fn();
    bridge.onExportProgress.mockImplementation((listener) => {
      report = listener;
      return unsubscribe;
    });
    const progress: MusicExportProgress = {
      destination: 'C:\\Export',
      total: 81,
      completed: 81,
      copied: 80,
      failed: 1,
      currentFile: 'missing.mp3',
    };
    let finish: ((value: unknown) => void) | undefined;
    bridge.exportFiles.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    bridge.playlists.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 12,
          name: 'Road Mix',
          track_count: 1,
          total_duration_ms: 120000,
          average_rating: 7,
        },
      ],
    });
    bridge.playlistTracks.mockResolvedValue({
      ok: true,
      data: (await bridge.search()).data.rows,
    });
    render(<MusicApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }));
    fireEvent.click(await screen.findByRole('button', { name: /Road Mix/ }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Export files' }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
    await screen.findByText('No tags found.');
    await act(async () => {
      report?.({ ...progress, completed: 40, copied: 40, failed: 0 });
    });
    expect(
      screen.getByRole('progressbar', { name: 'File copy progress' }),
    ).toHaveAttribute('value', '40');
    await act(async () => {
      finish?.({
        ok: true,
        data: {
          ...progress,
          errors: [
            { fileName: 'missing.mp3', message: 'Track is unavailable.' },
          ],
        },
      });
    });
    expect(
      screen.getByRole('region', { name: 'File export' }),
    ).toHaveTextContent('80 copied, 1 failed');
    expect(screen.getByRole('alert')).toHaveTextContent('missing.mp3');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('reports cancellation and export request failures', async () => {
    bridge.playlists.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 12,
          name: 'Road Mix',
          track_count: 1,
          total_duration_ms: 120000,
          average_rating: 7,
        },
      ],
    });
    bridge.playlistTracks.mockResolvedValue({
      ok: true,
      data: (await bridge.search()).data.rows,
    });
    render(<MusicApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }));
    fireEvent.click(await screen.findByRole('button', { name: /Road Mix/ }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Export files' }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export files' }));
    await screen.findByText('Export cancelled. No files copied.');
    bridge.exportFiles.mockResolvedValue({
      ok: false,
      error: { code: 'FAILED', message: 'Destination is unavailable.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export files' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Destination is unavailable.',
    );
  });

  it('exports a selected playlist', async () => {
    bridge.playlists.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 12,
          name: 'Road Mix',
          track_count: 1,
          total_duration_ms: 120000,
          average_rating: 7,
        },
      ],
    });
    bridge.playlistTracks.mockResolvedValue({
      ok: true,
      data: (await bridge.search()).data.rows,
    });
    render(<MusicApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }));
    fireEvent.click(await screen.findByRole('button', { name: /Road Mix/ }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Export files' }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export files' }));
    await waitFor(() =>
      expect(bridge.exportFiles).toHaveBeenCalledWith({
        kind: 'playlist',
        id: 12,
      }),
    );
  });

  it('shows the playing track properties without changing views', async () => {
    render(<MusicApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Play song' }));
    await waitFor(() => expect(bridge.playbackSource).toHaveBeenCalledWith(3));
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Music player' }),
      ).toHaveTextContent('Song'),
    );
    expect(await screen.findByLabelText('Title')).toHaveValue('Song');
    const panel = screen.getByRole('region', { name: 'Track details' });
    expect(within(panel).getByLabelText('Artists')).toHaveValue('Artist');
    expect(within(panel).getByText('Dance')).toBeInTheDocument();
    expect(within(panel).getByText('Electronic')).toBeInTheDocument();
    expect(within(panel).getByRole('img', { name: 'Rating' })).toHaveAttribute(
      'aria-label',
      '7 Stars',
    );
    expect(panel).toHaveTextContent('C:\\Music\\song.mp3');
    expect(bridge.detail).toHaveBeenCalledWith(3);
    expect(bridge.trackPlaylists).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
    await screen.findByText('No tags found.');
    expect(
      screen.getByRole('region', { name: 'Music player' }),
    ).toHaveTextContent('Song');
  });

  it('replaces the selected properties on playback but still allows manual inspection', async () => {
    const firstTrack = (await bridge.search()).data.rows[0];
    const firstDetail = (await bridge.detail()).data;
    const secondTrack = {
      ...firstTrack,
      id: 4,
      path: 'C:\\Music\\second.mp3',
      title: 'Second Song',
    };
    bridge.search.mockResolvedValue({
      ok: true,
      data: { total: 2, rows: [firstTrack, secondTrack] },
    });
    bridge.detail.mockImplementation(async (id) => ({
      ok: true,
      data: id === 4 ? { ...firstDetail, ...secondTrack } : firstDetail,
    }));
    render(<MusicApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open song' }));
    expect(await screen.findByLabelText('Title')).toHaveValue('Song');
    fireEvent.click(screen.getByRole('button', { name: 'Play second' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Title')).toHaveValue('Second Song'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open song' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Title')).toHaveValue('Song'),
    );
    expect(
      screen.getByRole('region', { name: 'Music player' }),
    ).toHaveTextContent('Second Song');
  });

  it('restores the last track paused at its saved position and volume', async () => {
    bridge.playbackState.mockResolvedValue({
      ok: true,
      data: {
        track: {
          id: 3,
          path: 'C:\\Music\\song.mp3',
          title: 'Song',
          album: 'Album',
          duration_ms: 120000,
          status: 'present',
          metadata_incomplete: 0,
          rating: 7,
        },
        positionSeconds: 32,
        volume: 0.4,
      },
    });
    const { container } = render(<MusicApp />);
    const audio = container.querySelector('audio')!;
    await waitFor(() => expect(bridge.playbackSource).toHaveBeenCalledWith(3));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled(),
    );
    Object.defineProperty(audio, 'duration', {
      configurable: true,
      value: 120,
    });
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(32);
    expect(audio.volume).toBe(0.4);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(bridge.savePlaybackState).toHaveBeenCalledWith({
      trackId: 3,
      positionSeconds: 32,
      volume: 0.4,
    });
    expect(bridge.detail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(await screen.findByLabelText('Title')).toHaveValue('Song');
  });

  it('creates a playlist and shows its summary in the Playlists view', async () => {
    bridge.playlists.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 12,
          name: 'Road Mix',
          track_count: 0,
          total_duration_ms: 0,
          average_rating: null,
        },
      ],
    });
    render(<MusicApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }));
    fireEvent.change(screen.getByLabelText('New playlist'), {
      target: { value: ' Road Mix ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create playlist' }));
    await waitFor(() =>
      expect(bridge.createPlaylist).toHaveBeenCalledWith('Road Mix'),
    );
    expect(await screen.findByText('Road Mix')).toBeInTheDocument();
    expect(screen.getByText('0 tracks · 0:00 · —')).toBeInTheDocument();
    expect(screen.getByText(/Average score/)).toHaveTextContent(
      'Average score —',
    );
  });

  it('opens a playlist linked from track details and plays its ordered tracks', async () => {
    const secondTrack = {
      id: 4,
      path: 'C:\\Music\\second.mp3',
      title: 'Second Song',
      album: 'Album',
      duration_ms: 60000,
      status: 'present' as const,
      metadata_incomplete: 0 as const,
      rating: 8,
    };
    bridge.playlists.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 12,
          name: 'Road Mix',
          track_count: 2,
          total_duration_ms: 180000,
          average_rating: 7.5,
        },
      ],
    });
    bridge.trackPlaylists.mockResolvedValue({
      ok: true,
      data: [{ id: 12, name: 'Road Mix' }],
    });
    bridge.playlistTracks.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 3,
          path: 'C:\\Music\\song.mp3',
          title: 'Song',
          album: 'Album',
          duration_ms: 120000,
          status: 'present',
          metadata_incomplete: 0,
          rating: 7,
        },
        secondTrack,
      ],
    });
    const firstDetail = (await bridge.detail()).data;
    bridge.detail.mockImplementation(async (id) => ({
      ok: true,
      data:
        id === secondTrack.id
          ? { ...firstDetail, ...secondTrack, artists: ['Second Artist'] }
          : firstDetail,
    }));
    bridge.detail.mockClear();
    render(<MusicApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open song' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Road Mix' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Play playlist' }),
    );
    await waitFor(() => expect(bridge.playbackSource).toHaveBeenCalledWith(3));
    const audio = document.querySelector('audio')!;
    fireEvent.ended(audio);
    await waitFor(() => expect(bridge.playbackSource).toHaveBeenCalledWith(4));
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Music player' }),
      ).toHaveTextContent('Second Song'),
    );
    expect(
      screen.getByRole('heading', { name: 'Playlists' }),
    ).toBeInTheDocument();
    expect(bridge.detail).toHaveBeenCalledWith(4);
    expect(bridge.trackPlaylists).toHaveBeenCalledWith(4);
    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    expect(await screen.findByLabelText('Title')).toHaveValue('Second Song');
    expect(screen.getByLabelText('Artists')).toHaveValue('Second Artist');
  });

  it('plays a random track from the collection', async () => {
    bridge.randomTrack.mockResolvedValue({
      ok: true,
      data: {
        id: 9,
        path: 'C:\\Music\\random.mp3',
        title: 'Random Song',
        album: 'Album',
        duration_ms: 120000,
        status: 'present',
        metadata_incomplete: 0,
        rating: null,
      },
    });
    const firstDetail = (await bridge.detail()).data;
    bridge.detail.mockResolvedValue({
      ok: true,
      data: {
        ...firstDetail,
        id: 9,
        path: 'C:\\Music\\random.mp3',
        title: 'Random Song',
      },
    });
    bridge.detail.mockClear();
    render(<MusicApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Play random track' }));
    await waitFor(() => expect(bridge.randomTrack).toHaveBeenCalled());
    await waitFor(() => expect(bridge.playbackSource).toHaveBeenCalledWith(9));
    expect(
      await screen.findByRole('region', { name: 'Music player' }),
    ).toHaveTextContent('Random Song');
    expect(await screen.findByLabelText('Title')).toHaveValue('Random Song');
    expect(bridge.detail).toHaveBeenCalledWith(9);
  });

  it('filters the Library by rating ranges and resets to the first page', async () => {
    const result = await bridge.search();
    bridge.search.mockResolvedValue({
      ...result,
      data: { ...result.data, total: 240 },
    });
    render(<MusicApp />);
    await screen.findByRole('button', { name: 'Open song' });
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Page 5' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(bridge.search).toHaveBeenLastCalledWith('', 40, 40, 'all'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Page 4' }));
    await waitFor(() =>
      expect(bridge.search).toHaveBeenLastCalledWith('', 40, 120, 'all'),
    );
    fireEvent.click(screen.getByRole('button', { name: '5-star tracks' }));
    await waitFor(() =>
      expect(bridge.search).toHaveBeenLastCalledWith('', 40, 0, '5-star'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Lower-rated tracks' }));
    await waitFor(() =>
      expect(bridge.search).toHaveBeenLastCalledWith('', 40, 0, 'lower'),
    );
  });

  it('opens the searchable Artists screen and lists songs for a selected artist', async () => {
    bridge.tags.mockResolvedValue({
      ok: true,
      data: [{ id: 7, name: 'Artist', track_count: 1 }],
    });
    bridge.tagSongs.mockResolvedValue({
      ok: true,
      data: {
        total: 1,
        rows: [
          {
            id: 3,
            path: 'C:\\Music\\song.mp3',
            title: 'Song',
            album: 'Album',
            duration_ms: 120000,
            status: 'present',
            metadata_incomplete: 0,
            rating: 7,
          },
        ],
      },
    });
    render(<MusicApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Artists' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Artist 1' }));
    await waitFor(() =>
      expect(bridge.tagSongs).toHaveBeenCalledWith('artist', 7, 40, 0),
    );
    expect(
      await screen.findByRole('button', { name: 'Open song' }),
    ).toBeInTheDocument();
  });

  it.each(['Artists', 'Tags'])(
    'updates playing track details from %s without leaving the view',
    async (view) => {
      bridge.tags.mockResolvedValue({
        ok: true,
        data: [{ id: 7, name: 'Artist', track_count: 1 }],
      });
      bridge.tagSongs.mockResolvedValue({
        ok: true,
        data: (await bridge.search()).data,
      });
      render(<MusicApp />);
      fireEvent.click(screen.getByRole('button', { name: view }));
      fireEvent.click(await screen.findByRole('button', { name: 'Artist 1' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Play song' }));
      await waitFor(() => expect(bridge.detail).toHaveBeenCalledWith(3));
      expect(screen.getByRole('heading', { name: view })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Library' }));
      expect(await screen.findByLabelText('Title')).toHaveValue('Song');
    },
  );

  it('edits playlist order and confirms playlist removal', async () => {
    bridge.playlists.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 12,
          name: 'Road Mix',
          track_count: 2,
          total_duration_ms: 180000,
          average_rating: 7.5,
        },
      ],
    });
    bridge.playlistTracks.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 3,
          path: 'C:\\Music\\song.mp3',
          title: 'Song',
          album: 'Album',
          duration_ms: 120000,
          status: 'present',
          metadata_incomplete: 0,
          rating: 7,
        },
        {
          id: 4,
          path: 'C:\\Music\\second.mp3',
          title: 'Second Song',
          album: 'Album',
          duration_ms: 60000,
          status: 'present',
          metadata_incomplete: 0,
          rating: 8,
        },
      ],
    });
    render(<MusicApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }));
    fireEvent.click(await screen.findByRole('button', { name: /Road Mix/ }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Move Second Song up' }),
    );
    await waitFor(() =>
      expect(bridge.movePlaylistTrack).toHaveBeenCalledWith(12, 4, 0),
    );
    fireEvent.change(screen.getByLabelText('Playlist name'), {
      target: { value: 'Gym Mix' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bridge.renamePlaylist).toHaveBeenCalledWith(12, 'Gym Mix'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove playlist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
    await waitFor(() => expect(bridge.deletePlaylist).toHaveBeenCalledWith(12));
  });

  it('adds tracks found through library search without adding duplicates', async () => {
    bridge.playlists.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 12,
          name: 'Road Mix',
          track_count: 1,
          total_duration_ms: 120000,
          average_rating: 7,
        },
      ],
    });
    bridge.playlistTracks.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 3,
          path: 'C:\\Music\\song.mp3',
          title: 'Song',
          album: 'Album',
          duration_ms: 120000,
          status: 'present',
          metadata_incomplete: 0,
          rating: 7,
        },
      ],
    });
    bridge.search.mockResolvedValue({
      ok: true,
      data: {
        total: 2,
        rows: [
          {
            id: 3,
            path: 'C:\\Music\\song.mp3',
            title: 'Song',
            album: 'Album',
            duration_ms: 120000,
            status: 'present',
            metadata_incomplete: 0,
            rating: 7,
          },
          {
            id: 4,
            path: 'C:\\Music\\new.mp3',
            title: 'New Song',
            album: 'Album',
            duration_ms: 60000,
            status: 'present',
            metadata_incomplete: 0,
            rating: 8,
          },
        ],
      },
    });
    render(<MusicApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }));
    fireEvent.click(await screen.findByRole('button', { name: /Road Mix/ }));
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search tracks to add' }),
      {
        target: { value: 'new' },
      },
    );
    expect(
      await screen.findByRole('button', { name: 'Add Song to playlist' }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Add New Song to playlist' }),
    );
    await waitFor(() =>
      expect(bridge.addPlaylistTrack).toHaveBeenCalledWith(12, 4),
    );
  });

  it('generates a completionist playlist with filters and reports history reset', async () => {
    const playlist = {
      id: 21,
      name: 'Completionist Mix',
      track_count: 2,
      total_duration_ms: 72000,
      average_rating: 9,
    };
    bridge.tags.mockResolvedValue({
      ok: true,
      data: [
        { id: 3, name: 'Jazz', track_count: 2 },
        { id: 4, name: 'Rock', track_count: 1 },
      ],
    });
    bridge.playlists.mockResolvedValue({ ok: true, data: [playlist] });
    bridge.createCompletionistPlaylist.mockResolvedValue({
      ok: true,
      data: {
        playlist,
        tracks: [
          {
            id: 3,
            path: 'C:\\Music\\song.mp3',
            title: 'Song',
            album: 'Album',
            duration_ms: 120000,
            status: 'present',
            metadata_incomplete: 0,
            rating: 10,
          },
        ],
        historyReset: true,
      },
    });
    render(<MusicApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Completionist playlist' }),
    );
    fireEvent.change(screen.getByLabelText('Playlist name'), {
      target: { value: 'Completionist Mix' },
    });
    fireEvent.change(screen.getByLabelText('Rating filter'), {
      target: { value: '5-star' },
    });
    fireEvent.change(screen.getByLabelText('Target length (minutes)'), {
      target: { value: '45' },
    });
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Require Jazz' }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Disallow Rock' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate playlist' }));
    await waitFor(() =>
      expect(bridge.createCompletionistPlaylist).toHaveBeenCalledWith({
        name: 'Completionist Mix',
        ratingFilter: '5-star',
        requiredGenreIds: [3],
        excludedGenreIds: [4],
        targetMinutes: 45,
      }),
    );
    expect(
      await screen.findByText(
        'History reset for matching tracks. Created Completionist Mix with 1 track.',
      ),
    ).toBeInTheDocument();
  });

  it('reports when no present tracks match the completionist filters', async () => {
    render(<MusicApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Completionist playlist' }),
    );
    fireEvent.change(screen.getByLabelText('Playlist name'), {
      target: { value: 'No matches' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate playlist' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'No present tracks match these filters.',
    );
    expect(bridge.createCompletionistPlaylist).toHaveBeenCalled();
  });

  it('shows the filenames and reasons for scan-time artist correction failures', async () => {
    bridge.scan.mockResolvedValue({
      ok: true,
      data: {
        addedOrUpdated: 0,
        unchanged: 0,
        missing: 0,
        failed: 1,
        cancelled: false,
        errors: [
          {
            fileName: 'locked-song.mp3',
            message: 'The audio file cannot be written.',
          },
        ],
      },
    });
    render(<MusicApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Sources' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'locked-song.mp3: The audio file cannot be written.',
    );
  });

  it.each([0, 1])(
    'highlights incomplete metadata flag %s, including selected rows',
    async (flag) => {
      const { data } = await bridge.search();
      bridge.search.mockResolvedValue({
        ok: true,
        data: {
          ...data,
          rows: data.rows.map((row: { id: number }) => ({
            ...row,
            metadata_incomplete: flag,
          })),
        },
      });
      render(<MusicApp />);
      const button = await screen.findByRole('button', { name: 'Open song' });
      const row = button.parentElement!;
      expect(row.classList.contains('metadata-incomplete')).toBe(Boolean(flag));
      expect(row.getAttribute('title')).toBe(
        flag ? 'Missing artist, title, genre or rating tags.' : null,
      );
      fireEvent.click(button);
      await screen.findByDisplayValue('Song');
      expect(row).toHaveClass('selected');
      expect(row.classList.contains('metadata-incomplete')).toBe(Boolean(flag));
    },
  );

  it('renders safely before selection and while track details are loading', async () => {
    const { data } = await bridge.detail();
    let finish: ((result: { ok: true; data: TrackDetail }) => void) | undefined;
    bridge.detail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<MusicApp />);
    expect(screen.getByText('Select a track')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Open song' }));
    expect(bridge.detail).toHaveBeenLastCalledWith(3);
    expect(screen.getByText('Select a track')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await act(async () => {
      finish?.({ ok: true, data });
    });
    const panel = within(screen.getByRole('region', { name: 'Track details' }));
    expect(
      panel.getByRole('button', { name: 'Dad music' }),
    ).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'MLP' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Views' })).queryByRole(
        'checkbox',
      ),
    ).not.toBeInTheDocument();
  });

  it.each([null, 0, 1])(
    'displays and saves track flags initially set to %s',
    async (flag) => {
      const { data } = await bridge.detail();
      bridge.detail.mockResolvedValue({
        ok: true,
        data: { ...data, is_dad: flag, is_mlp: flag },
      });
      render(<MusicApp />);
      fireEvent.click(await screen.findByRole('button', { name: 'Open song' }));
      await screen.findByDisplayValue('Song');
      const panel = within(
        screen.getByRole('region', { name: 'Track details' }),
      );
      const dad = panel.getByRole('button', { name: 'Dad music' });
      const mlp = panel.getByRole('button', { name: 'MLP' });
      [dad, mlp].forEach((badge) => {
        expect(badge).toHaveAttribute('aria-pressed', String(flag === 1));
        expect(badge.classList.contains('active')).toBe(flag === 1);
        expect(badge.getAttribute('title')).toBe(
          flag === null ? 'Not set' : null,
        );
        fireEvent.click(badge);
      });
      [dad, mlp].forEach((badge) => {
        expect(badge).toHaveAttribute('aria-pressed', String(flag !== 1));
        expect(badge.classList.contains('active')).toBe(flag !== 1);
      });
      fireEvent.click(panel.getByRole('button', { name: 'Save tags' }));
      await waitFor(() =>
        expect(bridge.edit).toHaveBeenCalledWith(3, {
          title: 'Song',
          artists: ['Artist'],
          genres: ['Dance', 'Electronic'],
          isDad: flag !== 1,
          isMlp: flag !== 1,
        }),
      );
    },
  );

  it('disables track flag edits for missing files', async () => {
    const { data } = await bridge.detail();
    bridge.detail.mockResolvedValue({
      ok: true,
      data: { ...data, status: 'missing' },
    });
    render(<MusicApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open song' }));
    await screen.findByDisplayValue('Song');
    const panel = within(screen.getByRole('region', { name: 'Track details' }));
    expect(panel.getByRole('button', { name: 'Dad music' })).toBeDisabled();
    expect(panel.getByRole('button', { name: 'MLP' })).toBeDisabled();
  });

  it('manages library sources on a dedicated screen', async () => {
    bridge.roots.mockResolvedValue({
      ok: true,
      data: [
        { id: 1, root_path: 'C:\\Music' },
        { id: 2, root_path: 'D:\\More' },
      ],
    });
    render(<MusicApp />);
    await screen.findByRole('button', { name: 'Open song' });
    expect(
      screen.queryByRole('button', { name: 'Add folder' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Chosen folder')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sources' }));
    expect(await screen.findByLabelText('Chosen folder')).toHaveValue('1');
    fireEvent.change(screen.getByLabelText('Chosen folder'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }));
    await waitFor(() => expect(bridge.scan).toHaveBeenCalledWith(2));
    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    await screen.findByRole('button', { name: 'Open song' });
    expect(bridge.search).toHaveBeenCalledWith('', 40, 0, 'all');
  });

  it('adds a folder, scans, opens a track and saves tags', async () => {
    render(<MusicApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Sources' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    await waitFor(() => expect(bridge.scan).toHaveBeenCalledWith(1));
    expect(
      await screen.findByText('1 indexed, 0 missing, 0 failed.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open song' }));
    expect(await screen.findByDisplayValue('Song')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Song'), {
      target: { value: 'New song' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
    await waitFor(() =>
      expect(bridge.edit).toHaveBeenCalledWith(3, {
        title: 'New song',
        artists: ['Artist'],
        genres: ['Dance', 'Electronic'],
      }),
    );
  });

  it('shows ten rating stars and editable genre chips without hidden tag fields', async () => {
    render(<MusicApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open song' }));
    await screen.findByDisplayValue('Song');
    const panel = within(screen.getByRole('region', { name: 'Track details' }));
    expect(panel.queryByLabelText('Album')).not.toBeInTheDocument();
    expect(panel.queryByLabelText('Year')).not.toBeInTheDocument();
    expect(panel.queryByLabelText('Track')).not.toBeInTheDocument();
    const stars = panel.getByRole('img', { name: 'Rating' });
    expect(stars.querySelectorAll('.MuiRating-icon')).toHaveLength(10);
    expect(stars.querySelectorAll('.MuiRating-iconFilled')).toHaveLength(7);
    expect(panel.getByText('Dance')).toHaveClass('MuiChip-label');
    expect(panel.getByText('Electronic')).toHaveClass('MuiChip-label');
    fireEvent.change(panel.getByRole('combobox'), {
      target: { value: 'Ambient' },
    });
    fireEvent.keyDown(panel.getByRole('combobox'), { key: 'Enter' });
    expect(panel.getByText('Ambient')).toHaveClass('MuiChip-label');
    fireEvent.click(panel.getByRole('button', { name: 'Save tags' }));
    await waitFor(() =>
      expect(bridge.edit).toHaveBeenCalledWith(3, {
        title: 'Song',
        artists: ['Artist'],
        genres: ['Dance', 'Electronic', 'Ambient'],
      }),
    );
  });

  it('previews filters, saves the reviewed tracks, and opens the new playlist', async () => {
    const { data } = await bridge.search();
    const track = data.rows[0];
    bridge.filterTracks.mockResolvedValue({
      ok: true,
      data: { total: 1, totalDurationMs: 90000, rows: [track] },
    });
    bridge.playlists.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 17,
          name: 'Filtered Mix',
          track_count: 1,
          total_duration_ms: 90000,
          average_rating: 7,
        },
      ],
    });
    bridge.playlistTracks.mockResolvedValue({
      ok: true,
      data: [track],
    });
    bridge.createFilteredPlaylist.mockResolvedValue({
      ok: true,
      data: {
        playlist: {
          id: 17,
          name: 'Filtered Mix',
          track_count: 1,
          total_duration_ms: 90000,
          average_rating: 7,
        },
      },
    });

    render(<MusicApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(await screen.findByText('1 track · 1:30 total')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Open song' }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search'), {
      target: { value: 'Song' },
    });
    fireEvent.change(screen.getByLabelText('Dad music'), {
      target: { value: 'yes' },
    });
    fireEvent.change(screen.getByLabelText('MLP'), {
      target: { value: 'no' },
    });
    await waitFor(() =>
      expect(bridge.filterTracks).toHaveBeenLastCalledWith(
        {
          text: 'Song',
          artistIds: [],
          artistMatch: 'any',
          requiredGenreIds: [],
          excludedGenreIds: [],
          minRating: null,
          maxRating: null,
          minDurationSeconds: null,
          maxDurationSeconds: null,
          dad: 'yes',
          mlp: 'no',
        },
        40,
        0,
      ),
    );

    fireEvent.change(screen.getByLabelText('Playlist name'), {
      target: { value: 'Filtered Mix' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save all as playlist' }),
    );
    await waitFor(() =>
      expect(bridge.createFilteredPlaylist).toHaveBeenCalledWith({
        name: 'Filtered Mix',
        filter: expect.objectContaining({
          text: 'Song',
          dad: 'yes',
          mlp: 'no',
        }),
      }),
    );
    expect(
      await screen.findByText('Created Filtered Mix with 1 track.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open playlist' }));
    expect(
      await screen.findByRole('button', { name: /Filtered Mix/ }),
    ).toBeInTheDocument();
  });

  it.each([null, 0, 10])(
    'renders rating %s with the correct number of filled stars',
    async (rating) => {
      const original = (await bridge.detail()).data;
      bridge.detail.mockResolvedValue({
        ok: true,
        data: { ...original, rating },
      });
      render(<MusicApp />);
      fireEvent.click(await screen.findByRole('button', { name: 'Open song' }));
      await screen.findByDisplayValue('Song');
      const stars = within(
        screen.getByRole('region', { name: 'Track details' }),
      ).getByRole('img', { name: 'Rating' });
      expect(stars.querySelectorAll('.MuiRating-icon')).toHaveLength(10);
      expect(stars.querySelectorAll('.MuiRating-iconFilled')).toHaveLength(
        rating ?? 0,
      );
    },
  );

  it('plays and pauses the selected track with the spacebar', async () => {
    jest
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(function pause(this: HTMLMediaElement) {
        this.dispatchEvent(new Event('pause'));
      });
    render(<MusicApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open song' }));
    await screen.findByDisplayValue('Song');
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeEnabled();
    expect(bridge.playbackSource).toHaveBeenCalledWith(3);
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(await screen.findByRole('button', { name: 'Play' })).toBeEnabled();
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeEnabled();
    fireEvent.keyDown(
      screen.getByRole('searchbox', { name: 'Search collection' }),
      { key: ' ' },
    );
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
  });

  it('starts the selected track with the spacebar while another plays', async () => {
    bridge.search.mockResolvedValue({
      ok: true,
      data: {
        total: 2,
        rows: [
          {
            id: 3,
            path: 'C:\\Music\\song.mp3',
            title: 'Song',
            album: 'Album',
            duration_ms: 120000,
            status: 'present',
            metadata_incomplete: 0,
            rating: 7,
          },
          {
            id: 4,
            path: 'C:\\Music\\other.mp3',
            title: 'Other',
            album: 'Album',
            duration_ms: 60000,
            status: 'present',
            metadata_incomplete: 0,
            rating: null,
          },
        ],
      },
    });
    render(<MusicApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Play song' }));
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeEnabled();
    expect(bridge.playbackSource).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: 'Open other' }));
    fireEvent.keyDown(document.body, { key: ' ' });
    await waitFor(() => expect(bridge.playbackSource).toHaveBeenCalledWith(4));
  });
});
