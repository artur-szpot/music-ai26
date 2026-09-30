import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import TagManager from '../renderer/TagManager';

describe('tag management view', () => {
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
  const onTrackOpen = jest.fn();
  const onChanged = jest.fn();
  const onTrackPlay = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    window.music = bridge;
    bridge.tags.mockImplementation(async (kind) => ({
      ok: true,
      data:
        kind === 'artist'
          ? [
              { id: 1, name: 'Singer', track_count: 1 },
              { id: 2, name: 'Misspelled', track_count: 1 },
            ]
          : [
              { id: 3, name: 'Dance', track_count: 1 },
              { id: 4, name: 'Misspelled', track_count: 1 },
            ],
    }));
    bridge.tagSongs.mockResolvedValue({
      ok: true,
      data: {
        total: 1,
        rows: [
          {
            id: 42,
            title: 'One song',
            album: 'Album',
            path: 'C:\\Music\\song.mp3',
            duration_ms: 1000,
            status: 'present',
            metadata_incomplete: 0,
            rating: 7,
          },
        ],
      },
    });
    bridge.addTag.mockResolvedValue({
      ok: true,
      data: { id: 5, name: 'New genre' },
    });
    bridge.moveTag.mockResolvedValue({
      ok: true,
      data: {
        destinationId: 3,
        updated: 1,
        remaining: 1,
        errors: [{ trackId: 99, message: 'File is offline.' }],
      },
    });
  });

  it.each([0, 1])(
    'highlights incomplete metadata flag %s in tag song lists',
    async (flag) => {
      const { data } = await bridge.tagSongs();
      bridge.tagSongs.mockResolvedValue({
        ok: true,
        data: {
          ...data,
          rows: data.rows.map((row: { id: number }) => ({
            ...row,
            metadata_incomplete: flag,
          })),
        },
      });
      render(
        <TagManager
          kind="genre"
          onTrackOpen={onTrackOpen}
          onTrackPlay={onTrackPlay}
          onChanged={onChanged}
        />,
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Dance 1' }));
      const row = await screen.findByRole('button', { name: 'Open song' });
      expect(row.parentElement!.classList.contains('metadata-incomplete')).toBe(
        Boolean(flag),
      );
      fireEvent.click(row);
      expect(onTrackOpen).toHaveBeenCalledWith(42);
    },
  );

  it('only lists genres and views songs for a selected genre tag', async () => {
    render(
      <TagManager
        kind="genre"
        onTrackOpen={onTrackOpen}
        onTrackPlay={onTrackPlay}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Dance 1' }));
    expect(bridge.tags).toHaveBeenCalledWith('genre');
    expect(bridge.tags).not.toHaveBeenCalledWith('artist');
    expect(
      screen.queryByRole('button', { name: 'Artists' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Genres' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Singer')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(bridge.tagSongs).toHaveBeenCalledWith('genre', 3, 40, 0),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Open song' }));
    expect(onTrackOpen).toHaveBeenCalledWith(42);
    fireEvent.click(screen.getByRole('button', { name: 'Play song' }));
    expect(onTrackPlay).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42, rating: 7 }),
    );
  });

  it('adds a tag and requires an explicit fuzzy source selection before merging', async () => {
    render(
      <TagManager
        kind="genre"
        onTrackOpen={onTrackOpen}
        onTrackPlay={onTrackPlay}
        onChanged={onChanged}
      />,
    );
    fireEvent.change(screen.getByLabelText('New genre'), {
      target: { value: 'New genre' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    await waitFor(() =>
      expect(bridge.addTag).toHaveBeenCalledWith('genre', 'New genre'),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Dance 1' }));
    fireEvent.change(screen.getByLabelText('Source tag'), {
      target: { value: 'Mispeld' },
    });
    expect(screen.getByRole('button', { name: 'Merge tags' })).toBeDisabled();
    fireEvent.click(screen.getByRole('option', { name: /Misspelled/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Merge tags' }));
    await waitFor(() =>
      expect(bridge.moveTag).toHaveBeenCalledWith('genre', 4, 'Dance'),
    );
    expect(
      await screen.findByText('1 songs updated; 1 still use Misspelled.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Song #99: File is offline/)).toBeInTheDocument();
  });

  it('merges the current genre into an explicitly selected destination', async () => {
    bridge.moveTag.mockResolvedValue({
      ok: true,
      data: { destinationId: 3, updated: 1, remaining: 0, errors: [] },
    });
    render(
      <TagManager
        kind="genre"
        onTrackOpen={onTrackOpen}
        onTrackPlay={onTrackPlay}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Misspelled 1' }),
    );
    const action = screen.getByRole('button', {
      name: 'Merge into selected tag',
    });
    expect(action).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Destination tag'), {
      target: { value: 'Danc' },
    });
    expect(action).toBeDisabled();
    fireEvent.click(screen.getByRole('option', { name: 'Dance 1 songs' }));
    expect(action).toBeEnabled();
    fireEvent.click(action);
    await waitFor(() =>
      expect(bridge.moveTag).toHaveBeenCalledWith('genre', 4, 'Dance'),
    );
    expect(
      await screen.findByText('Misspelled updated across 1 songs.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Destination tag')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Dance 1' })).toHaveClass(
      'selected',
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows the merge result as a toast that disappears after 5 seconds', async () => {
    jest.useFakeTimers();
    bridge.moveTag.mockResolvedValue({
      ok: true,
      data: { destinationId: 3, updated: 1, remaining: 0, errors: [] },
    });
    render(
      <TagManager
        kind="genre"
        onTrackOpen={onTrackOpen}
        onTrackPlay={onTrackPlay}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Misspelled 1' }),
    );
    fireEvent.change(screen.getByLabelText('Destination tag'), {
      target: { value: 'Danc' },
    });
    fireEvent.click(screen.getByRole('option', { name: 'Dance 1 songs' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Merge into selected tag' }),
    );
    const toast = await screen.findByText('Misspelled updated across 1 songs.');
    expect(toast).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(
      screen.queryByText('Misspelled updated across 1 songs.'),
    ).not.toBeInTheDocument();
    jest.useRealTimers();
  });

  it('excludes self-merges and clears destination selection when changing genres', async () => {
    render(
      <TagManager
        kind="genre"
        onTrackOpen={onTrackOpen}
        onTrackPlay={onTrackPlay}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Dance 1' }));
    fireEvent.change(screen.getByLabelText('Destination tag'), {
      target: { value: 'Dance' },
    });
    expect(
      screen.queryByRole('option', { name: 'Dance 1 songs' }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Destination tag'), {
      target: { value: 'Mispeld' },
    });
    fireEvent.click(screen.getByRole('option', { name: 'Misspelled 1 songs' }));
    expect(
      screen.getByRole('button', { name: 'Merge into selected tag' }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Misspelled 1' }));
    expect(screen.getByLabelText('Destination tag')).toHaveValue('');
    expect(
      screen.getByRole('button', { name: 'Merge into selected tag' }),
    ).toBeDisabled();
    await screen.findByRole('button', { name: 'Open song' });
  });

  it('renames a tag to a new name without merge confirmation', async () => {
    render(
      <TagManager
        kind="genre"
        onTrackOpen={onTrackOpen}
        onTrackPlay={onTrackPlay}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Dance 1' }));
    const nameInput = screen.getByLabelText('Name');
    expect(nameInput).toHaveValue('Dance');
    fireEvent.change(nameInput, {
      target: { value: 'Electronic' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() =>
      expect(bridge.moveTag).toHaveBeenCalledWith('genre', 3, 'Electronic'),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('searches the artist list, browses songs, and corrects the embedded name', async () => {
    bridge.tags.mockResolvedValue({
      ok: true,
      data: [
        { id: 1, name: 'Singer', track_count: 1 },
        ...Array.from({ length: 81 }, (_, index) => ({
          id: index + 10,
          name: `Late Artist ${index}`,
          track_count: 0,
        })),
        { id: 2, name: 'Misspelled', track_count: 1 },
      ],
    });
    render(
      <TagManager
        kind="artist"
        onTrackOpen={onTrackOpen}
        onTrackPlay={onTrackPlay}
        onChanged={onChanged}
      />,
    );
    expect(
      await screen.findByRole('heading', { name: 'Artists' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Late Artist 80 0' }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Find artists')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Find artists'), {
      target: { value: 'Mispeld' },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Misspelled 1' }),
    );
    await waitFor(() =>
      expect(bridge.tagSongs).toHaveBeenCalledWith('artist', 2, 40, 0),
    );
    expect(
      screen.getByText(/remember the previous spelling for future scans/),
    ).toBeInTheDocument();
    const nameInput = screen.getByLabelText('Name');
    expect(nameInput).toHaveValue('Misspelled');
    fireEvent.change(nameInput, {
      target: { value: 'Corrected Artist' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Correct artist' }));
    await waitFor(() =>
      expect(bridge.moveTag).toHaveBeenCalledWith(
        'artist',
        2,
        'Corrected Artist',
      ),
    );
    expect(bridge.tags).toHaveBeenCalledWith('artist');
    expect(onChanged).toHaveBeenCalled();
  });
});
