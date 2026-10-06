/* eslint react/require-default-props: ["error", { "functions": "defaultArguments" }] */
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import Rating from '@mui/material/Rating';
import type { TrackSummary } from '../main/musicCatalog';

type TrackRowProps = {
  track: TrackSummary;
  selected?: boolean;
  compact?: boolean;
  onOpen: (id: number) => void;
  onPlay: (track: TrackSummary) => void;
};

export default function TrackRow({
  track,
  selected = false,
  compact = false,
  onOpen,
  onPlay,
}: TrackRowProps) {
  const name =
    track.title || track.path.split(/[\\/]/).pop() || 'Untitled track';
  const seconds = Math.floor(track.duration_ms / 1000);
  return (
    <div
      className={`music-row${compact ? ' compact' : ''}${selected ? ' selected' : ''}${track.metadata_incomplete ? ' metadata-incomplete' : ''}`}
      title={
        track.metadata_incomplete
          ? 'Missing artist, title, genre or rating tags.'
          : undefined
      }
    >
      <button
        type="button"
        className="music-track-open"
        aria-label={`Open ${name}`}
        onClick={() => onOpen(track.id)}
      >
        <span className="music-title">
          {name}
          {track.status === 'missing' && <small>Missing</small>}
        </span>
        <Rating
          className="music-list-rating"
          value={track.rating === null ? null : track.rating / 2}
          precision={0.5}
          max={5}
          readOnly
          size="small"
          aria-label={
            track.rating === null
              ? 'No rating'
              : `${track.rating / 2} out of 5 stars`
          }
        />
        {!compact && (
          <span className="music-length">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
          </span>
        )}
      </button>
      <button
        type="button"
        className="music-track-play"
        aria-label={`Play ${name}`}
        disabled={track.status === 'missing'}
        onClick={() => onPlay(track)}
      >
        <PlayArrowIcon fontSize="small" />
      </button>
    </div>
  );
}
