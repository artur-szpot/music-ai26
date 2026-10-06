import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TagManager from '../renderer/TagManager';

describe('tag management view', () => {
  const bridge = {
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
          onTrackOpen={onTrackOpen}
          onTrackPlay={onTrackPlay}
          onChanged={onChanged}
        />,
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Dance 1' }));
      const row = await screen.findByRole('button', { name: 'Open One song' });
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
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open One song' }),
    );
    expect(onTrackOpen).toHaveBeenCalledWith(42);
    fireEvent.click(screen.getByRole('button', { name: 'Play One song' }));
    expect(onTrackPlay).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42, rating: 7 }),
    );
  });

  it('adds a tag and requires an explicit fuzzy source selection before merging', async () => {
    render(
      <TagManager
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
    expect(
      screen.getByRole('alertdialog', { name: 'Confirm tag merge' }),
    ).toHaveTextContent('Merge Misspelled into Dance?');
    expect(bridge.moveTag).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(bridge.moveTag).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Merge tags' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' }));
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
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Merge Misspelled into Dance?',
    );
    expect(bridge.moveTag).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(bridge.moveTag).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Destination tag'), {
      target: { value: 'Danc' },
    });
    expect(action).toBeDisabled();
    fireEvent.click(screen.getByRole('option', { name: 'Dance 1 songs' }));
    fireEvent.click(action);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' }));
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

  it('excludes self-merges and clears destination selection when changing genres', async () => {
    render(
      <TagManager
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
    await screen.findByRole('button', { name: 'Open One song' });
  });

  it('renames a tag to a new name without merge confirmation', async () => {
    render(
      <TagManager
        onTrackOpen={onTrackOpen}
        onTrackPlay={onTrackPlay}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Dance 1' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Electronic' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() =>
      expect(bridge.moveTag).toHaveBeenCalledWith('genre', 3, 'Electronic'),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
