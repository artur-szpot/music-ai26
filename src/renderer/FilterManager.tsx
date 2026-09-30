import { useDeferredValue, useEffect, useState } from 'react';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import type {
  CatalogTag,
  TrackFilter,
  TrackFlagFilter,
  TrackSummary,
} from '../main/musicCatalog';
import MusicPagination from './MusicPagination';
import TrackRow from './TrackRow';

const pageSize = 40;

const initialFilter: TrackFilter = {
  text: '',
  artistIds: [],
  artistMatch: 'any',
  requiredGenreIds: [],
  excludedGenreIds: [],
  minRating: null,
  maxRating: null,
  minDurationSeconds: null,
  maxDurationSeconds: null,
  dad: 'any',
  mlp: 'any',
};

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

type FilterManagerProps = {
  onTrackOpen: (id: number) => void;
  onTrackPlay: (track: TrackSummary) => void;
  onPlaylistCreated: (id: number) => void;
  onOpenPlaylist: () => void;
};

export default function FilterManager({
  onTrackOpen,
  onTrackPlay,
  onPlaylistCreated,
  onOpenPlaylist,
}: FilterManagerProps) {
  const [artists, setArtists] = useState<CatalogTag[]>([]);
  const [genres, setGenres] = useState<CatalogTag[]>([]);
  const [filter, setFilter] = useState<TrackFilter>(initialFilter);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<TrackSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [totalDurationMs, setTotalDurationMs] = useState(0);
  const [playlistName, setPlaylistName] = useState('');
  const [loadingTags, setLoadingTags] = useState(true);
  const [loadingTracks, setLoadingTracks] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const deferredFilter = useDeferredValue(filter);

  useEffect(() => {
    let active = true;
    Promise.all([window.music.tags('artist'), window.music.tags('genre')])
      .then(
        ([artistResult, genreResult]) => {
          if (!active) return undefined;
          if (!artistResult.ok) setError(artistResult.error.message);
          else if (!genreResult.ok) setError(genreResult.error.message);
          else {
            setArtists(artistResult.data);
            setGenres(genreResult.data);
          }
          setLoadingTags(false);
          return undefined;
        },
        (cause) => {
          if (active) {
            setError(
              cause instanceof Error
                ? cause.message
                : 'Could not load filter tags.',
            );
            setLoadingTags(false);
          }
          return undefined;
        },
      )
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load filter tags.',
          );
          setLoadingTags(false);
        }
        return undefined;
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingTracks(true);
    setError('');
    window.music
      .filterTracks(deferredFilter, pageSize, page * pageSize)
      .then(
        (result) => {
          if (!active) return undefined;
          if (!result.ok) {
            setError(result.error.message);
            setRows([]);
            setTotal(0);
            setTotalDurationMs(0);
          } else {
            setRows(result.data.rows);
            setTotal(result.data.total);
            setTotalDurationMs(result.data.totalDurationMs);
          }
          setLoadingTracks(false);
          return undefined;
        },
        (cause) => {
          if (active) {
            setError(
              cause instanceof Error
                ? cause.message
                : 'Could not filter the collection.',
            );
            setRows([]);
            setTotal(0);
            setTotalDurationMs(0);
            setLoadingTracks(false);
          }
          return undefined;
        },
      )
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not filter the collection.',
          );
          setRows([]);
          setTotal(0);
          setTotalDurationMs(0);
          setLoadingTracks(false);
        }
        return undefined;
      });
    return () => {
      active = false;
    };
  }, [deferredFilter, page]);

  const updateFilter = (changes: Partial<TrackFilter>) => {
    setLoadingTracks(true);
    setFilter((current) => ({ ...current, ...changes }));
    setPage(0);
    setMessage('');
  };

  const savePlaylist = async () => {
    if (!playlistName.trim() || total === 0) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await window.music.createFilteredPlaylist({
        name: playlistName.trim(),
        filter,
      });
      if (!result.ok) throw new Error(result.error.message);
      if (!result.data.playlist) {
        setMessage('No present tracks match these filters.');
        return;
      }
      setPlaylistName('');
      setMessage(
        `Created ${result.data.playlist.name} with ${result.data.playlist.track_count} ${result.data.playlist.track_count === 1 ? 'track' : 'tracks'}.`,
      );
      onPlaylistCreated(result.data.playlist.id);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not create a filtered playlist.',
      );
    } finally {
      setBusy(false);
    }
  };

  const selectedArtists = artists.filter(({ id }) =>
    filter.artistIds.includes(id),
  );
  const requiredGenres = genres.filter(({ id }) =>
    filter.requiredGenreIds.includes(id),
  );
  const excludedGenres = genres.filter(({ id }) =>
    filter.excludedGenreIds.includes(id),
  );

  return (
    <main className="music-main filter-manager">
      <header className="music-toolbar">
        <h1>Filter tracks</h1>
      </header>
      {(message || error) && (
        <div
          className={error ? 'music-alert error' : 'music-alert'}
          role={error ? 'alert' : 'status'}
        >
          {error || message}
          {message.startsWith('Created ') && (
            <button
              type="button"
              className="filter-open-playlist"
              onClick={onOpenPlaylist}
            >
              Open playlist
            </button>
          )}
        </div>
      )}
      <div className="filter-layout">
        <form
          className="filter-controls"
          onSubmit={(event) => event.preventDefault()}
        >
          <h2>
            <FilterAltIcon fontSize="small" /> Criteria
          </h2>
          <label htmlFor="filter-text">
            Search
            <input
              id="filter-text"
              type="search"
              maxLength={200}
              value={filter.text}
              placeholder="Title, artist, album, genre, path"
              onChange={(event) => updateFilter({ text: event.target.value })}
            />
          </label>
          <Autocomplete
            multiple
            options={artists}
            value={selectedArtists}
            getOptionLabel={(artist) => artist.name}
            onChange={(_event, values) =>
              updateFilter({ artistIds: values.map(({ id }) => id) })
            }
            renderInput={(params) => (
              <TextField
                slotProps={{
                  input: params.InputProps,
                  htmlInput: params.inputProps,
                  inputLabel: params.InputLabelProps,
                }}
                disabled={loadingTags}
                fullWidth
                id="filter-artists"
                label="Artists"
                size="small"
              />
            )}
          />
          {filter.artistIds.length > 1 && (
            <label htmlFor="filter-artist-match">
              Artist matching
              <select
                id="filter-artist-match"
                value={filter.artistMatch}
                onChange={(event) => {
                  if (
                    event.target.value === 'any' ||
                    event.target.value === 'all'
                  )
                    updateFilter({ artistMatch: event.target.value });
                }}
              >
                <option value="any">Any selected artist</option>
                <option value="all">All selected artists</option>
              </select>
            </label>
          )}
          <Autocomplete
            multiple
            options={genres}
            value={requiredGenres}
            getOptionLabel={(genre) => genre.name}
            onChange={(_event, values) =>
              updateFilter({
                requiredGenreIds: values.map(({ id }) => id),
                excludedGenreIds: filter.excludedGenreIds.filter(
                  (id) => !values.some((genre) => genre.id === id),
                ),
              })
            }
            renderInput={(params) => (
              <TextField
                slotProps={{
                  input: params.InputProps,
                  htmlInput: params.inputProps,
                  inputLabel: params.InputLabelProps,
                }}
                disabled={loadingTags}
                fullWidth
                id="filter-required-genres"
                label="Require all genres"
                size="small"
              />
            )}
          />
          <Autocomplete
            multiple
            options={genres}
            value={excludedGenres}
            getOptionLabel={(genre) => genre.name}
            onChange={(_event, values) =>
              updateFilter({
                excludedGenreIds: values.map(({ id }) => id),
                requiredGenreIds: filter.requiredGenreIds.filter(
                  (id) => !values.some((genre) => genre.id === id),
                ),
              })
            }
            renderInput={(params) => (
              <TextField
                slotProps={{
                  input: params.InputProps,
                  htmlInput: params.inputProps,
                  inputLabel: params.InputLabelProps,
                }}
                disabled={loadingTags}
                fullWidth
                id="filter-excluded-genres"
                label="Exclude any genre"
                size="small"
              />
            )}
          />
          <fieldset className="filter-range">
            <legend>Track flags</legend>
            <label htmlFor="filter-dad">
              Dad music
              <select
                id="filter-dad"
                value={filter.dad}
                onChange={(event) => {
                  const { value } = event.target;
                  if (value === 'any' || value === 'yes' || value === 'no')
                    updateFilter({ dad: value as TrackFlagFilter });
                }}
              >
                <option value="any">Any</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label htmlFor="filter-mlp">
              MLP
              <select
                id="filter-mlp"
                value={filter.mlp}
                onChange={(event) => {
                  const { value } = event.target;
                  if (value === 'any' || value === 'yes' || value === 'no')
                    updateFilter({ mlp: value as TrackFlagFilter });
                }}
              >
                <option value="any">Any</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          </fieldset>
          <fieldset className="filter-range">
            <legend>Rating range (0–10)</legend>
            <label htmlFor="filter-rating-min">
              Minimum
              <input
                id="filter-rating-min"
                type="number"
                min={0}
                max={10}
                step={1}
                value={filter.minRating ?? ''}
                onChange={(event) =>
                  updateFilter({
                    minRating:
                      event.target.value === ''
                        ? null
                        : Number(event.target.value),
                  })
                }
              />
            </label>
            <label htmlFor="filter-rating-max">
              Maximum
              <input
                id="filter-rating-max"
                type="number"
                min={0}
                max={10}
                step={1}
                value={filter.maxRating ?? ''}
                onChange={(event) =>
                  updateFilter({
                    maxRating:
                      event.target.value === ''
                        ? null
                        : Number(event.target.value),
                  })
                }
              />
            </label>
          </fieldset>
          <fieldset className="filter-range">
            <legend>Duration range (minutes)</legend>
            <label htmlFor="filter-duration-min">
              Minimum
              <input
                id="filter-duration-min"
                type="number"
                min={0}
                step={1}
                value={
                  filter.minDurationSeconds === null
                    ? ''
                    : filter.minDurationSeconds / 60
                }
                onChange={(event) =>
                  updateFilter({
                    minDurationSeconds:
                      event.target.value === ''
                        ? null
                        : Number(event.target.value) * 60,
                  })
                }
              />
            </label>
            <label htmlFor="filter-duration-max">
              Maximum
              <input
                id="filter-duration-max"
                type="number"
                min={0}
                step={1}
                value={
                  filter.maxDurationSeconds === null
                    ? ''
                    : filter.maxDurationSeconds / 60
                }
                onChange={(event) =>
                  updateFilter({
                    maxDurationSeconds:
                      event.target.value === ''
                        ? null
                        : Number(event.target.value) * 60,
                  })
                }
              />
            </label>
          </fieldset>
        </form>
        <section className="filter-results" aria-label="Filtered tracks">
          <div className="filter-summary">
            <div>
              <h2>Preview</h2>
              <p>
                {total} {total === 1 ? 'track' : 'tracks'} ·{' '}
                {formatDuration(totalDurationMs)} total
              </p>
            </div>
            <form
              className="filter-save"
              onSubmit={async (event) => {
                event.preventDefault();
                await savePlaylist();
              }}
            >
              <label htmlFor="filtered-playlist-name">
                Playlist name
                <input
                  id="filtered-playlist-name"
                  maxLength={200}
                  required
                  value={playlistName}
                  onChange={(event) => setPlaylistName(event.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={busy || loadingTracks || total === 0 || !!error}
              >
                <PlaylistAddIcon fontSize="small" /> Save all as playlist
              </button>
            </form>
          </div>
          <div className="filter-track-list">
            <div className="music-list-heading">
              <span>Title</span>
              <span>Rating</span>
              <span>Length</span>
              <span>Play</span>
            </div>
            {loadingTracks && <p className="music-empty">Loading...</p>}
            {!loadingTracks && rows.length === 0 && (
              <p className="music-empty">
                No present tracks match these filters.
              </p>
            )}
            {!loadingTracks &&
              rows.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  onOpen={onTrackOpen}
                  onPlay={onTrackPlay}
                />
              ))}
            <MusicPagination
              page={page}
              pageSize={pageSize}
              total={total}
              itemLabel="Track"
              onPageChange={setPage}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
