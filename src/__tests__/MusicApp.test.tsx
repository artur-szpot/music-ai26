import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  };

  beforeEach(() => {
    window.music = bridge;
    bridge.roots.mockResolvedValue({ ok: true, data: [] });
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
        genres: ['Dance'],
        year: 2024,
        track_number: 2,
        duration_ms: 120000,
        size_bytes: 100,
        mtime_ms: 1000,
        status: 'present',
      },
    });
    bridge.edit.mockImplementation(async (_id, changes) => ({
      ok: true,
      data: { ...(await bridge.detail()).data, ...changes },
    }));
  });

  it('adds a folder, scans, opens a track and saves tags', async () => {
    render(<MusicApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    await waitFor(() => expect(bridge.scan).toHaveBeenCalledWith(1));
    expect(
      await screen.findByText('1 indexed, 0 missing, 0 failed.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Song Album 2:00/ }));
    expect(await screen.findByDisplayValue('Song')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Song'), {
      target: { value: 'New song' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
    await waitFor(() =>
      expect(bridge.edit).toHaveBeenCalledWith(
        3,
        expect.objectContaining({
          title: 'New song',
          artists: ['Artist'],
          genres: ['Dance'],
          year: 2024,
          track: 2,
        }),
      ),
    );
  });
});
