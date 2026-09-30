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
  };
  const onTrackOpen = jest.fn();
  const onChanged = jest.fn();

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
          : [{ id: 3, name: 'Dance', track_count: 1 }],
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
          },
        ],
      },
    });
    bridge.addTag.mockResolvedValue({
      ok: true,
      data: { id: 5, name: 'New artist' },
    });
    bridge.moveTag.mockResolvedValue({
      ok: true,
      data: {
        destinationId: 1,
        updated: 1,
        remaining: 1,
        errors: [{ trackId: 99, message: 'File is offline.' }],
      },
    });
  });

  it('views songs for a selected tag and switches tag kinds', async () => {
    render(<TagManager onTrackOpen={onTrackOpen} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Singer 1' }));
    await waitFor(() =>
      expect(bridge.tagSongs).toHaveBeenCalledWith('artist', 1, 40, 0),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /One song Album/ }),
    );
    expect(onTrackOpen).toHaveBeenCalledWith(42);
    fireEvent.click(screen.getByRole('button', { name: 'Genres' }));
    expect(
      await screen.findByRole('button', { name: 'Dance 1' }),
    ).toBeInTheDocument();
  });

  it('adds a tag and requires an explicit fuzzy source selection before merging', async () => {
    render(<TagManager onTrackOpen={onTrackOpen} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText('New artist'), {
      target: { value: 'New artist' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    await waitFor(() =>
      expect(bridge.addTag).toHaveBeenCalledWith('artist', 'New artist'),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Singer 1' }));
    fireEvent.change(screen.getByLabelText('Source tag'), {
      target: { value: 'Mispeld' },
    });
    expect(screen.getByRole('button', { name: 'Merge tags' })).toBeDisabled();
    fireEvent.click(screen.getByRole('option', { name: /Misspelled/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Merge tags' }));
    expect(
      screen.getByRole('alertdialog', { name: 'Confirm tag merge' }),
    ).toHaveTextContent('Merge Misspelled into Singer?');
    expect(bridge.moveTag).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(bridge.moveTag).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Merge tags' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' }));
    await waitFor(() =>
      expect(bridge.moveTag).toHaveBeenCalledWith('artist', 2, 'Singer'),
    );
    expect(
      await screen.findByText('1 songs updated; 1 still use Misspelled.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Song #99: File is offline/)).toBeInTheDocument();
  });

  it('renames a tag to a new name without merge confirmation', async () => {
    render(<TagManager onTrackOpen={onTrackOpen} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Singer 1' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Vocalist' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() =>
      expect(bridge.moveTag).toHaveBeenCalledWith('artist', 1, 'Vocalist'),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
