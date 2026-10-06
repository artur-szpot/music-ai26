import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import TrackRow from '../renderer/TrackRow';
import type { TrackSummary } from '../main/musicCatalog';

const track: TrackSummary = {
  id: 3,
  path: 'C:\\Music\\song.mp3',
  title: 'Song',
  album: 'Hidden album',
  rating: 7,
  duration_ms: 120000,
  status: 'present',
  metadata_incomplete: 0,
};

describe('track rows', () => {
  it.each([0, 1, 7, 10, null])(
    'shows rating %s on a five-star half-step scale',
    (rating) => {
      render(
        <TrackRow
          track={{ ...track, rating }}
          onOpen={jest.fn()}
          onPlay={jest.fn()}
        />,
      );
      const stars = screen.getByRole('img', {
        name: rating === null ? 'No rating' : `${rating / 2} out of 5 stars`,
      });
      expect(stars.querySelectorAll('.MuiRating-decimal')).toHaveLength(5);
      expect(stars.querySelectorAll('.MuiRating-iconFilled')).toHaveLength(
        rating ?? 0,
      );
      expect(stars.querySelectorAll('.MuiRating-iconEmpty')).toHaveLength(
        10 - (rating ?? 0),
      );
      expect(screen.queryByText('Hidden album')).not.toBeInTheDocument();
    },
  );

  it('opens details and plays via separate buttons', () => {
    const onOpen = jest.fn();
    const onPlay = jest.fn();
    render(<TrackRow track={track} onOpen={onOpen} onPlay={onPlay} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play Song' }));
    expect(onPlay).toHaveBeenCalledWith(track);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open Song' }));
    expect(onOpen).toHaveBeenCalledWith(3);
  });

  it('disables playback for a missing track while keeping details accessible', () => {
    const onPlay = jest.fn();
    render(
      <TrackRow
        track={{ ...track, status: 'missing' }}
        onOpen={jest.fn()}
        onPlay={onPlay}
      />,
    );
    expect(screen.getByRole('button', { name: 'Play Song' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open Song' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Play Song' }));
    expect(onPlay).not.toHaveBeenCalled();
  });
});
