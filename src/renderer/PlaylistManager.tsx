import { useEffect, useMemo, useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay';
import SaveIcon from '@mui/icons-material/Save';
import SearchIcon from '@mui/icons-material/Search';
import FileCopyIcon from '@mui/icons-material/FileCopy';
import type { MusicExportRequest } from '../constants/musicIpc';
import type {
  CatalogTag,
  PlaylistSummary,
  TrackRatingFilter,
  TrackSummary,
} from '../main/musicCatalog';
import TrackRow from './TrackRow';

type PlaylistManagerProps = {
  selectedPlaylistId: number | null;
  onSelectPlaylist: (id: number | null) => void;
  onTrackOpen: (id: number) => void;
  onTrackPlay: (track: TrackSummary) => void;
  onPlaylistPlay: (tracks: TrackSummary[]) => void;
  onChanged: () => void;
  onExport: (request: MusicExportRequest) => Promise<void>;
  exporting: boolean;
};

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatAverageRating(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}/10`;
}

export default function PlaylistManager({
  selectedPlaylistId,
  onSelectPlaylist,
  onTrackOpen,
  onTrackPlay,
  onPlaylistPlay,
  onChanged,
  onExport,
  exporting,
}: PlaylistManagerProps) {
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [genres, setGenres] = useState<CatalogTag[]>([]);
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [searchRows, setSearchRows] = useState<TrackSummary[]>([]);
  const [newName, setNewName] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [generatorName, setGeneratorName] = useState('');
  const [ratingFilter, setRatingFilter] = useState<TrackRatingFilter>('all');
  const [requiredGenreIds, setRequiredGenreIds] = useState<number[]>([]);
  const [excludedGenreIds, setExcludedGenreIds] = useState<number[]>([]);
  const [targetMinutes, setTargetMinutes] = useState(60);

  const selected = playlists.find(({ id }) => id === selectedPlaylistId);
  const memberIds = useMemo(
    () => new Set(tracks.map(({ id }) => id)),
    [tracks],
  );

  useEffect(() => {
    let active = true;
    window.music
      .tags('genre')
      .then((result) => {
        if (!active) return undefined;
        if (!result.ok) throw new Error(result.error.message);
        setGenres(result.data);
        return undefined;
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load genres for playlist generation.',
          );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    window.music
      .playlists()
      .then((result) => {
        if (!active) return undefined;
        if (!result.ok) throw new Error(result.error.message);
        setPlaylists(result.data);
        if (
          selectedPlaylistId !== null &&
          !result.data.some(({ id }) => id === selectedPlaylistId)
        ) {
          onSelectPlaylist(null);
        }
        return undefined;
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load playlists.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [onSelectPlaylist, revision, selectedPlaylistId]);

  useEffect(() => {
    let active = true;
    setNameDraft(selected?.name ?? '');
    setConfirmDelete(false);
    setTracks([]);
    if (selectedPlaylistId === null) {
      return () => {
        active = false;
      };
    }
    window.music
      .playlistTracks(selectedPlaylistId)
      .then((result) => {
        if (!active) return undefined;
        if (!result.ok) throw new Error(result.error.message);
        setTracks(result.data);
        return undefined;
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load playlist tracks.',
          );
      });
    return () => {
      active = false;
    };
  }, [revision, selectedPlaylistId, selected?.name]);

  useEffect(() => {
    let active = true;
    if (selectedPlaylistId === null || !query.trim()) {
      setSearchRows([]);
      return () => {
        active = false;
      };
    }
    window.music
      .search(query.trim(), 20, 0, 'all')
      .then((result) => {
        if (!active) return undefined;
        if (!result.ok) throw new Error(result.error.message);
        setSearchRows(result.data.rows);
        return undefined;
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not search the library.',
          );
      });
    return () => {
      active = false;
    };
  }, [query, selectedPlaylistId]);

  const changed = () => {
    setRevision((value) => value + 1);
    onChanged();
  };

  const create = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await window.music.createPlaylist(newName.trim());
      if (!result.ok) throw new Error(result.error.message);
      setNewName('');
      onSelectPlaylist(result.data.id);
      setMessage(`${result.data.name} created.`);
      changed();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not create playlist.',
      );
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    if (!selected || !nameDraft.trim()) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await window.music.renamePlaylist(
        selected.id,
        nameDraft.trim(),
      );
      if (!result.ok) throw new Error(result.error.message);
      setMessage('Playlist renamed.');
      changed();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not rename playlist.',
      );
    } finally {
      setBusy(false);
    }
  };

  const removePlaylist = async () => {
    if (!selected) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await window.music.deletePlaylist(selected.id);
      if (!result.ok) throw new Error(result.error.message);
      if (!result.data) throw new Error('Playlist not found.');
      onSelectPlaylist(null);
      setConfirmDelete(false);
      setMessage(`${selected.name} removed.`);
      changed();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not remove playlist.',
      );
    } finally {
      setBusy(false);
    }
  };

  const addTrack = async (track: TrackSummary) => {
    if (!selected || memberIds.has(track.id)) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await window.music.addPlaylistTrack(selected.id, track.id);
      if (!result.ok) throw new Error(result.error.message);
      setMessage('Track added to playlist.');
      changed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add track.');
    } finally {
      setBusy(false);
    }
  };

  const removeTrack = async (track: TrackSummary) => {
    if (!selected) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await window.music.removePlaylistTrack(
        selected.id,
        track.id,
      );
      if (!result.ok) throw new Error(result.error.message);
      setMessage('Track removed from playlist.');
      changed();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not remove track.',
      );
    } finally {
      setBusy(false);
    }
  };

  const moveTrack = async (track: TrackSummary, position: number) => {
    if (!selected) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await window.music.movePlaylistTrack(
        selected.id,
        track.id,
        position,
      );
      if (!result.ok) throw new Error(result.error.message);
      changed();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not reorder playlist.',
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleGenre = (
    genreId: number,
    selectedIds: number[],
    setSelectedIds: (ids: number[]) => void,
    otherIds: number[],
    setOtherIds: (ids: number[]) => void,
    checked: boolean,
  ) => {
    setSelectedIds(
      checked
        ? [...selectedIds, genreId]
        : selectedIds.filter((id) => id !== genreId),
    );
    if (checked) setOtherIds(otherIds.filter((id) => id !== genreId));
  };

  const generate = async () => {
    if (!generatorName.trim() || !Number.isSafeInteger(targetMinutes)) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await window.music.createCompletionistPlaylist({
        name: generatorName.trim(),
        ratingFilter,
        requiredGenreIds,
        excludedGenreIds,
        targetMinutes,
      });
      if (!result.ok) throw new Error(result.error.message);
      const { playlist, tracks: generatedTracks, historyReset } = result.data;
      if (!playlist) {
        setMessage('No present tracks match these filters.');
        return;
      }
      setGeneratorOpen(false);
      setGeneratorName('');
      onSelectPlaylist(playlist.id);
      setMessage(
        historyReset
          ? `History reset for matching tracks. Created ${playlist.name} with ${generatedTracks.length} ${generatedTracks.length === 1 ? 'track' : 'tracks'}.`
          : `Created ${playlist.name} with ${generatedTracks.length} ${generatedTracks.length === 1 ? 'track' : 'tracks'}.`,
      );
      changed();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not create completionist playlist.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="music-main playlist-manager">
      <header className="music-toolbar">
        <h1>Playlists</h1>
      </header>
      {(message || error) && !generatorOpen && (
        <div
          className={error ? 'music-alert error' : 'music-alert'}
          role="status"
        >
          {error || message}
        </div>
      )}
      {generatorOpen && (
        <div className="completionist-backdrop">
          <section
            className="completionist-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="completionist-title"
          >
            <h2 id="completionist-title">Create completionist playlist</h2>
            {(message || error) && (
              <div
                className={error ? 'music-alert error' : 'music-alert'}
                role={error ? 'alert' : 'status'}
              >
                {error || message}
              </div>
            )}
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                await generate();
              }}
            >
              <div className="completionist-field">
                <span>Playlist name</span>
                <input
                  id="completionist-name"
                  aria-label="Playlist name"
                  maxLength={200}
                  value={generatorName}
                  onChange={(event) => setGeneratorName(event.target.value)}
                  required
                />
              </div>
              <div className="completionist-field">
                <span>Rating filter</span>
                <select
                  id="completionist-rating"
                  aria-label="Rating filter"
                  value={ratingFilter}
                  onChange={(event) => {
                    const { value } = event.target;
                    if (
                      value === 'all' ||
                      value === '5-star' ||
                      value === '4-star' ||
                      value === '3-star' ||
                      value === 'lower'
                    ) {
                      setRatingFilter(value);
                    }
                  }}
                >
                  <option value="all">All ratings</option>
                  <option value="5-star">5-star (9–10)</option>
                  <option value="4-star">4-star (7–8)</option>
                  <option value="3-star">3-star (5–6)</option>
                  <option value="lower">Lower-rated (0–4)</option>
                </select>
              </div>
              <div className="completionist-field">
                <span>Target length (minutes)</span>
                <input
                  id="completionist-target"
                  aria-label="Target length (minutes)"
                  type="number"
                  min={1}
                  step={1}
                  value={targetMinutes}
                  onChange={(event) =>
                    setTargetMinutes(Number(event.target.value))
                  }
                  required
                />
              </div>
              <fieldset className="completionist-genres">
                <legend>Genre filters</legend>
                <div className="completionist-genre-heading">
                  <span>Genre</span>
                  <span>Required</span>
                  <span>Disallowed</span>
                </div>
                {genres.map((genre) => (
                  <div className="completionist-genre-row" key={genre.id}>
                    <span>{genre.name}</span>
                    <input
                      type="checkbox"
                      aria-label={`Require ${genre.name}`}
                      checked={requiredGenreIds.includes(genre.id)}
                      onChange={(event) =>
                        toggleGenre(
                          genre.id,
                          requiredGenreIds,
                          setRequiredGenreIds,
                          excludedGenreIds,
                          setExcludedGenreIds,
                          event.target.checked,
                        )
                      }
                    />
                    <input
                      type="checkbox"
                      aria-label={`Disallow ${genre.name}`}
                      checked={excludedGenreIds.includes(genre.id)}
                      onChange={(event) =>
                        toggleGenre(
                          genre.id,
                          excludedGenreIds,
                          setExcludedGenreIds,
                          requiredGenreIds,
                          setRequiredGenreIds,
                          event.target.checked,
                        )
                      }
                    />
                  </div>
                ))}
                {genres.length === 0 && (
                  <p className="music-empty">No genres in the library.</p>
                )}
              </fieldset>
              <p>
                Tracks already included in generated playlists are skipped. The
                track that passes the target length is included.
              </p>
              <div className="completionist-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setGeneratorOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    busy ||
                    !generatorName.trim() ||
                    !Number.isSafeInteger(targetMinutes) ||
                    targetMinutes < 1
                  }
                >
                  <PlaylistPlayIcon fontSize="small" /> Generate playlist
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      <div className="playlist-layout">
        <section className="playlist-sidebar" aria-label="Playlist list">
          <button
            type="button"
            className="playlist-generator-button"
            onClick={() => setGeneratorOpen(true)}
          >
            <PlaylistPlayIcon fontSize="small" /> Completionist playlist
          </button>
          <form
            className="playlist-create"
            onSubmit={async (event) => {
              event.preventDefault();
              await create();
            }}
          >
            <label htmlFor="new-playlist-name">
              New playlist
              <input
                id="new-playlist-name"
                maxLength={200}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Playlist name"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !newName.trim()}
              aria-label="Create playlist"
            >
              <AddIcon fontSize="small" /> Create
            </button>
          </form>
          {loading && <p className="music-empty">Loading playlists...</p>}
          {!loading && playlists.length === 0 && (
            <p className="music-empty">No playlists yet.</p>
          )}
          <div className="playlist-list">
            {playlists.map((playlist) => (
              <button
                type="button"
                key={playlist.id}
                className={
                  selectedPlaylistId === playlist.id ? 'active' : undefined
                }
                aria-current={
                  selectedPlaylistId === playlist.id ? 'true' : undefined
                }
                onClick={() => onSelectPlaylist(playlist.id)}
              >
                <strong>{playlist.name}</strong>
                <span>
                  {playlist.track_count} tracks ·{' '}
                  {formatDuration(playlist.total_duration_ms)} ·{' '}
                  {formatAverageRating(playlist.average_rating)}
                </span>
              </button>
            ))}
          </div>
        </section>
        <section className="playlist-detail" aria-label="Playlist details">
          {!selected ? (
            <div className="music-detail-placeholder">
              <PlaylistPlayIcon /> Create or select a playlist
            </div>
          ) : (
            <>
              <div className="playlist-heading">
                <form
                  className="playlist-rename"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    await rename();
                  }}
                >
                  <label htmlFor="playlist-name">
                    Playlist name
                    <input
                      id="playlist-name"
                      maxLength={200}
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={
                      busy || !nameDraft.trim() || nameDraft === selected.name
                    }
                  >
                    <SaveIcon fontSize="small" /> Save
                  </button>
                </form>
                <div className="playlist-actions">
                  <button
                    type="button"
                    disabled={exporting || busy || tracks.length === 0}
                    onClick={() =>
                      onExport({ kind: 'playlist', id: selected.id })
                    }
                  >
                    <FileCopyIcon fontSize="small" /> Export files
                  </button>
                  <button
                    type="button"
                    disabled={busy || tracks.length === 0}
                    onClick={() => onPlaylistPlay(tracks)}
                  >
                    <PlaylistPlayIcon fontSize="small" /> Play playlist
                  </button>
                  <button
                    type="button"
                    className="playlist-delete"
                    disabled={busy}
                    onClick={async () => removePlaylist()}
                  >
                    <DeleteOutlineIcon fontSize="small" />{' '}
                    {confirmDelete ? 'Confirm remove' : 'Remove playlist'}
                  </button>
                  {confirmDelete && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <p className="playlist-summary">
                  {selected.track_count} tracks ·{' '}
                  {formatDuration(selected.total_duration_ms)} total · Average
                  score {formatAverageRating(selected.average_rating)}
                </p>
              </div>
              <div className="playlist-content">
                <section
                  className="playlist-tracks"
                  aria-label="Playlist tracks"
                >
                  <h2>Tracks</h2>
                  {tracks.length === 0 ? (
                    <p className="music-empty">No tracks in this playlist.</p>
                  ) : (
                    tracks.map((track, index) => (
                      <div className="playlist-track" key={track.id}>
                        <TrackRow
                          track={track}
                          compact
                          onOpen={onTrackOpen}
                          onPlay={onTrackPlay}
                        />
                        <div className="playlist-track-actions">
                          <button
                            type="button"
                            aria-label={`Move ${track.title || 'track'} up`}
                            disabled={busy || index === 0}
                            onClick={async () => moveTrack(track, index - 1)}
                          >
                            <ArrowUpwardIcon fontSize="small" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${track.title || 'track'} down`}
                            disabled={busy || index === tracks.length - 1}
                            onClick={async () => moveTrack(track, index + 1)}
                          >
                            <ArrowDownwardIcon fontSize="small" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${track.title || 'track'} from playlist`}
                            disabled={busy}
                            onClick={async () => removeTrack(track)}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </section>
                <section
                  className="playlist-add-tracks"
                  aria-label="Add tracks"
                >
                  <h2>Add tracks</h2>
                  <label
                    className="music-search"
                    htmlFor="playlist-track-search"
                  >
                    <SearchIcon fontSize="small" />
                    <input
                      id="playlist-track-search"
                      type="search"
                      aria-label="Search tracks to add"
                      placeholder="Search library"
                      maxLength={200}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  {searchRows.map((track) => (
                    <div className="playlist-search-result" key={track.id}>
                      <TrackRow
                        track={track}
                        compact
                        onOpen={onTrackOpen}
                        onPlay={onTrackPlay}
                      />
                      <button
                        type="button"
                        disabled={busy || memberIds.has(track.id)}
                        aria-label={`Add ${track.title || 'track'} to playlist`}
                        onClick={async () => addTrack(track)}
                      >
                        <AddIcon fontSize="small" />
                      </button>
                    </div>
                  ))}
                </section>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
