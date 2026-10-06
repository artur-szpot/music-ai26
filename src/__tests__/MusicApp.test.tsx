import '@testing-library/jest-dom';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  cleanup,
} from '@testing-library/react';
import MusicApp from '../renderer/MusicApp';

describe('music collection window', () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {});
    jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    bridge.playbackSource.mockResolvedValue({
      ok: true,
      data: { url: 'music-audio://track/test' },
    });
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

  it('starts a track from its play button without opening details', async () => {
    render(<MusicApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Play Song' }));
    await waitFor(() => expect(bridge.playbackSource).toHaveBeenCalledWith(3));
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Music player' }),
      ).toHaveTextContent('Song'),
    );
    expect(bridge.detail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
    await screen.findByText('No tags found.');
    expect(
      screen.getByRole('region', { name: 'Music player' }),
    ).toHaveTextContent('Song');
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
      const button = await screen.findByRole('button', { name: 'Open Song' });
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

  it('adds a folder, scans, opens a track and saves tags', async () => {
    render(<MusicApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    await waitFor(() => expect(bridge.scan).toHaveBeenCalledWith(1));
    expect(
      await screen.findByText('1 indexed, 0 missing, 0 failed.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Song' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Open Song' }));
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

  it.each([null, 0, 10])(
    'renders rating %s with the correct number of filled stars',
    async (rating) => {
      const original = (await bridge.detail()).data;
      bridge.detail.mockResolvedValue({
        ok: true,
        data: { ...original, rating },
      });
      render(<MusicApp />);
      fireEvent.click(await screen.findByRole('button', { name: 'Open Song' }));
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
});
