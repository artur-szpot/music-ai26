import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from 'react';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import SearchIcon from '@mui/icons-material/Search';
import SaveIcon from '@mui/icons-material/Save';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import QueueMusicIcon from '@mui/icons-material/QueueMusic';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import PersonIcon from '@mui/icons-material/Person';
import StarIcon from '@mui/icons-material/Star';
import StarOutlineIcon from '@mui/icons-material/StarOutline';
import Autocomplete from '@mui/material/Autocomplete';
import Chip from '@mui/material/Chip';
import Rating from '@mui/material/Rating';
import TextField from '@mui/material/TextField';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import type {
  TrackDetail,
  TrackRatingFilter,
  TrackPlaylist,
  TrackSummary,
  PlaybackState,
} from '../main/musicCatalog';
import TagManager from './TagManager';
import PlaylistManager from './PlaylistManager';
import FilterManager from './FilterManager';
import SourcesManager from './SourcesManager';
import MusicPlayer, { MusicPlayerHandle, PlaybackRequest } from './MusicPlayer';
import MusicPagination from './MusicPagination';
import TrackRow from './TrackRow';
import type {
  MusicExportRequest,
  MusicExportProgress,
} from '../constants/musicIpc';
import './MusicApp.css';

type TagForm = {
  title: string;
  artists: string;
  genres: string[];
  isDad: boolean | null;
  isMlp: boolean | null;
};

const pageSize = 40;

const editForm = (track: TrackDetail): TagForm => ({
  title: track.title,
  artists: track.artists.join('\n'),
  genres: [...track.genres],
  isDad: track.is_dad === null ? null : track.is_dad === 1,
  isMlp: track.is_mlp === null ? null : track.is_mlp === 1,
});

export default function MusicApp() {
  const [view, setView] = useState<
    'library' | 'artists' | 'tags' | 'playlists' | 'filter' | 'sources'
  >('library');
  const [ratingFilter, setRatingFilter] = useState<TrackRatingFilter>('all');
  const [roots, setRoots] = useState<{ id: number; root_path: string }[]>([]);
  const [activeRoot, setActiveRoot] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [rows, setRows] = useState<TrackSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TrackDetail | null>(null);
  const [trackPlaylists, setTrackPlaylists] = useState<TrackPlaylist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(
    null,
  );
  const [form, setForm] = useState<TagForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] =
    useState<MusicExportProgress | null>(null);
  const [exportMessage, setExportMessage] = useState('');
  const [exportErrors, setExportErrors] = useState<
    { fileName: string; message: string }[]
  >([]);
  const [scanErrors, setScanErrors] = useState<
    { fileName: string; message: string }[]
  >([]);
  const [playback, setPlayback] = useState<PlaybackRequest | null>(null);
  const [initialVolume, setInitialVolume] = useState(1);
  const playbackStarted = useRef(false);
  const playerRef = useRef<MusicPlayerHandle>(null);
  const playTrack = useCallback((track: TrackSummary) => {
    playbackStarted.current = true;
    setPlayback((current) => ({
      track,
      sequence: (current?.sequence ?? 0) + 1,
    }));
  }, []);
  const spacebarContext = useRef({ selectedId, playback, detail, rows });
  spacebarContext.current = { selectedId, playback, detail, rows };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== ' ' ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      const { target } = event;
      if (
        target instanceof HTMLElement &&
        target.closest(
          'input, textarea, select, button, a[href], [contenteditable="true"], [role="button"], [role="checkbox"], [role="combobox"], [role="link"], [role="menuitem"], [role="option"], [role="slider"], [role="spinbutton"], [role="switch"], [role="tab"], [role="textbox"]',
        )
      )
        return;
      event.preventDefault();
      const {
        selectedId: currentSelectedId,
        playback: currentPlayback,
        detail: currentDetail,
        rows: currentRows,
      } = spacebarContext.current;
      if (
        currentSelectedId === null ||
        currentSelectedId === currentPlayback?.track.id
      ) {
        playerRef.current?.togglePlayback();
        return;
      }
      const selectedTrack =
        currentRows.find((row) => row.id === currentSelectedId) ??
        (currentDetail?.id === currentSelectedId ? currentDetail : null);
      if (selectedTrack) {
        playTrack(selectedTrack);
        return;
      }
      window.music
        .detail(currentSelectedId)
        .then((result) => {
          if (result.ok && result.data) playTrack(result.data);
          return undefined;
        })
        .catch(() => undefined);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playTrack]);
  const playPlaylist = (tracks: TrackSummary[]) => {
    if (!tracks.length) return;
    playbackStarted.current = true;
    setPlayback((current) => ({
      track: tracks[0],
      queue: tracks,
      sequence: (current?.sequence ?? 0) + 1,
    }));
  };
  const chooseRandomTrack = async (): Promise<TrackSummary | null> => {
    const result = await window.music.randomTrack();
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  };
  const playRandomTrack = async () => {
    setError('');
    setMessage('');
    try {
      const track = await chooseRandomTrack();
      if (!track) {
        setMessage('No playable tracks in the collection.');
        return;
      }
      playTrack(track);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not play a random track.',
      );
    }
  };

  useEffect(() => {
    let active = true;
    window.music
      .playbackState()
      .then((result) => {
        if (!active) return undefined;
        if (!result.ok) {
          setError(result.error.message);
          return undefined;
        }
        const savedState: PlaybackState = result.data;
        setInitialVolume(savedState.volume);
        if (savedState.track && !playbackStarted.current) {
          setPlayback({
            track: savedState.track,
            sequence: 1,
            startPositionSeconds: savedState.positionSeconds,
            autoplay: false,
          });
        }
        return undefined;
      })
      .catch(() => {
        if (active) setError('Could not restore playback state.');
      });
    window.music
      .roots()
      .then((result) => {
        if (!active) return undefined;
        if (result.ok) {
          setRoots(result.data);
          setActiveRoot(result.data[0]?.id ?? null);
        } else setError(result.error.message);
        return undefined;
      })
      .catch(() => {
        if (active) setError('Could not load music folders.');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    window.music
      .search(deferredQuery, pageSize, page * pageSize, ratingFilter)
      .then((result) => {
        if (!active) return undefined;
        if (result.ok) {
          setRows(result.data.rows);
          setTotal(result.data.total);
        } else setError(result.error.message);
        return undefined;
      })
      .catch(() => {
        if (active) setError('Could not search the collection.');
      })
      .finally(() => {
        if (active) setLoading(false);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [deferredQuery, page, ratingFilter, revision]);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setForm(null);
    if (selectedId !== null) {
      window.music
        .detail(selectedId)
        .then((result) => {
          if (!active) return undefined;
          if (result.ok && result.data) {
            setDetail(result.data);
            setForm(editForm(result.data));
          } else
            setError(result.ok ? 'Track not found.' : result.error.message);
          return undefined;
        })
        .catch(() => {
          if (active) setError('Could not load this track.');
        });
    }
    return () => {
      active = false;
    };
  }, [selectedId, revision]);

  useEffect(() => {
    let active = true;
    setTrackPlaylists([]);
    if (selectedId !== null) {
      window.music
        .trackPlaylists(selectedId)
        .then((result) => {
          if (!active) return undefined;
          if (result.ok) setTrackPlaylists(result.data);
          else setError(result.error.message);
          return undefined;
        })
        .catch(() => {
          if (active) setError('Could not load track playlists.');
        });
    }
    return () => {
      active = false;
    };
  }, [selectedId, revision]);

  const scan = async (rootId: number) => {
    setBusy(true);
    setError('');
    setMessage('Scanning music folder...');
    setScanErrors([]);
    try {
      const result = await window.music.scan(rootId);
      if (!result.ok) throw new Error(result.error.message);
      const { addedOrUpdated, failed, missing, cancelled, errors } =
        result.data;
      setScanErrors(errors);
      setMessage(
        cancelled
          ? 'Scan cancelled.'
          : `${addedOrUpdated} indexed, ${missing} missing, ${failed} failed.`,
      );
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Scan failed.');
    } finally {
      setBusy(false);
    }
  };

  const chooseRoot = async () => {
    setError('');
    try {
      const result = await window.music.chooseRoot();
      if (!result.ok) throw new Error(result.error.message);
      if (!result.data) return;
      setRoots((current) =>
        current.some(({ id }) => id === result.data!.id)
          ? current
          : [...current, result.data!],
      );
      setActiveRoot(result.data.id);
      await scan(result.data.id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not add folder.',
      );
    }
  };

  const save = async () => {
    if (!detail || !form) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.music.edit(detail.id, {
        title: form.title.trim(),
        artists: form.artists
          .split('\n')
          .map((name) => name.trim())
          .filter(Boolean),
        genres: form.genres,
        ...(form.isDad !== null && form.isDad !== (detail.is_dad === 1)
          ? { isDad: form.isDad }
          : {}),
        ...(form.isMlp !== null && form.isMlp !== (detail.is_mlp === 1)
          ? { isMlp: form.isMlp }
          : {}),
      });
      if (!result.ok) throw new Error(result.error.message);
      setDetail(result.data);
      setForm(editForm(result.data));
      setMessage('Tags saved to file.');
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save tags.');
    } finally {
      setBusy(false);
    }
  };

  const exportFiles = async (request: MusicExportRequest) => {
    setExporting(true);
    setExportProgress(null);
    setExportMessage('Choose and confirm an export destination.');
    setExportErrors([]);
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = window.music.onExportProgress(setExportProgress);
      const result = await window.music.exportFiles(request);
      if (!result.ok) throw new Error(result.error.message);
      if (!result.data) {
        setExportMessage('Export cancelled. No files copied.');
        return;
      }
      setExportProgress(result.data);
      setExportErrors(result.data.errors);
      setExportMessage(
        `Export finished: ${result.data.copied} copied, ${result.data.failed} failed.`,
      );
    } catch (cause) {
      setExportMessage('');
      setExportErrors([
        {
          fileName: 'Export',
          message: cause instanceof Error ? cause.message : 'Export failed.',
        },
      ]);
    } finally {
      unsubscribe?.();
      setExporting(false);
    }
  };

  return (
    <div className="music-shell">
      <div className="music-app">
        <aside className="music-sidebar">
          <div className="music-brand">
            <LibraryMusicIcon /> <span>Music Collection</span>
          </div>
          <nav className="music-navigation" aria-label="Views">
            <button
              type="button"
              className={view === 'library' ? 'active' : ''}
              aria-current={view === 'library' ? 'page' : undefined}
              onClick={() => {
                setView('library');
                setRatingFilter('all');
                setPage(0);
              }}
            >
              <LibraryMusicIcon fontSize="small" /> Library
            </button>
            <button
              type="button"
              className={view === 'filter' ? 'active' : ''}
              aria-current={view === 'filter' ? 'page' : undefined}
              onClick={() => setView('filter')}
            >
              <FilterAltIcon fontSize="small" /> Filter
            </button>
            <button
              type="button"
              className={view === 'artists' ? 'active' : ''}
              aria-current={view === 'artists' ? 'page' : undefined}
              onClick={() => setView('artists')}
            >
              <PersonIcon fontSize="small" /> Artists
            </button>
            <button
              type="button"
              className={view === 'tags' ? 'active' : ''}
              aria-current={view === 'tags' ? 'page' : undefined}
              onClick={() => setView('tags')}
            >
              <LocalOfferIcon fontSize="small" /> Tags
            </button>
            <button
              type="button"
              className={view === 'playlists' ? 'active' : ''}
              aria-current={view === 'playlists' ? 'page' : undefined}
              onClick={() => setView('playlists')}
            >
              <QueueMusicIcon fontSize="small" /> Playlists
            </button>
            <button
              type="button"
              className={view === 'sources' ? 'active' : ''}
              aria-current={view === 'sources' ? 'page' : undefined}
              onClick={() => setView('sources')}
            >
              <FolderOpenIcon fontSize="small" /> Sources
            </button>
          </nav>
          {view === 'library' && (
            <nav className="music-navigation" aria-label="Rating filters">
              {(
                [
                  ['5-star', '5-star tracks'],
                  ['4-star', '4-star tracks'],
                  ['3-star', '3-star tracks'],
                  ['lower', 'Lower-rated tracks'],
                ] as const
              ).map(([filter, label]) => (
                <button
                  key={filter}
                  type="button"
                  className={ratingFilter === filter ? 'active' : ''}
                  aria-current={ratingFilter === filter ? 'page' : undefined}
                  onClick={() => {
                    setRatingFilter(filter);
                    setPage(0);
                  }}
                >
                  {filter === 'lower' ? (
                    <StarOutlineIcon fontSize="small" />
                  ) : (
                    <StarIcon fontSize="small" />
                  )}
                  {label}
                </button>
              ))}
            </nav>
          )}
          {view === 'library' && (
            <div className="music-sidebar-section">
              <button
                type="button"
                className="music-command"
                disabled={busy}
                onClick={playRandomTrack}
              >
                <ShuffleIcon fontSize="small" /> Play random track
              </button>
            </div>
          )}
          {view === 'library' && (
            <div className="music-sidebar-footer">{total} tracks</div>
          )}
        </aside>
        {view === 'sources' && (
          <SourcesManager
            roots={roots}
            activeRoot={activeRoot}
            busy={busy}
            message={message}
            error={error}
            scanErrors={scanErrors}
            onSelectRoot={setActiveRoot}
            onAddFolder={chooseRoot}
            onRescan={scan}
            onCancelScan={() => window.music.cancelScan()}
          />
        )}
        {(view === 'artists' || view === 'tags') && (
          <TagManager
            key={view}
            kind={view === 'artists' ? 'artist' : 'genre'}
            onTrackPlay={playTrack}
            onChanged={() => setRevision((value) => value + 1)}
            onTrackOpen={(id) => {
              setSelectedId(id);
              setView('library');
              setRatingFilter('all');
              setPage(0);
            }}
          />
        )}
        {view === 'playlists' && (
          <PlaylistManager
            selectedPlaylistId={selectedPlaylistId}
            onSelectPlaylist={setSelectedPlaylistId}
            onTrackPlay={playTrack}
            onPlaylistPlay={playPlaylist}
            onChanged={() => setRevision((value) => value + 1)}
            onExport={exportFiles}
            exporting={exporting}
            onTrackOpen={(id) => {
              setSelectedId(id);
              setView('library');
              setRatingFilter('all');
              setPage(0);
            }}
          />
        )}
        {view === 'filter' && (
          <FilterManager
            onTrackPlay={playTrack}
            onTrackOpen={(id) => {
              setSelectedId(id);
              setView('library');
              setRatingFilter('all');
              setPage(0);
            }}
            onPlaylistCreated={setSelectedPlaylistId}
            onOpenPlaylist={() => setView('playlists')}
          />
        )}
        {view === 'library' && (
          <main className="music-main">
            <header className="music-toolbar">
              <h1>Library</h1>
              <label className="music-search" htmlFor="music-query">
                <SearchIcon fontSize="small" />
                <input
                  type="search"
                  id="music-query"
                  placeholder="Search tracks, artists, albums, genres"
                  aria-label="Search collection"
                  maxLength={200}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                  }}
                />
              </label>
            </header>
            {(message || error) && (
              <div
                className={error ? 'music-alert error' : 'music-alert'}
                role="status"
              >
                {error || message}
              </div>
            )}
            <div className="music-content">
              <section className="music-list" aria-label="Tracks">
                <div className="music-list-heading">
                  <span>Title</span>
                  <span>Rating</span>
                  <span>Length</span>
                  <span>Play</span>
                </div>
                {loading && <p className="music-empty">Loading...</p>}
                {!loading && rows.length === 0 && (
                  <p className="music-empty">
                    {roots.length
                      ? 'No matching tracks.'
                      : 'No music folders yet. Add one on the Sources screen.'}
                  </p>
                )}
                {!loading &&
                  rows.map((row) => (
                    <TrackRow
                      key={row.id}
                      track={row}
                      selected={selectedId === row.id}
                      onOpen={setSelectedId}
                      onPlay={playTrack}
                    />
                  ))}
                <MusicPagination
                  page={page}
                  pageSize={pageSize}
                  total={total}
                  itemLabel="Track"
                  onPageChange={setPage}
                />
              </section>
              <section className="music-detail" aria-label="Track details">
                {detail && form ? (
                  <>
                    <div className="music-detail-heading">
                      <h2>{detail.title || 'Untitled track'}</h2>
                      <span>
                        {detail.status === 'missing' ? 'Missing' : 'On disk'}
                      </span>
                    </div>
                    <div className="music-form">
                      <label htmlFor="music-title">
                        Title
                        <input
                          id="music-title"
                          value={form.title}
                          onChange={(event) =>
                            setForm({ ...form, title: event.target.value })
                          }
                        />
                      </label>
                      <label htmlFor="music-artists">
                        Artists
                        <textarea
                          id="music-artists"
                          rows={3}
                          value={form.artists}
                          onChange={(event) =>
                            setForm({ ...form, artists: event.target.value })
                          }
                        />
                      </label>
                      <div className="music-rating">
                        <span id="music-rating-label">Rating</span>
                        <Rating
                          aria-labelledby="music-rating-label"
                          max={10}
                          value={detail.rating}
                          readOnly
                          size="small"
                        />
                      </div>
                      <div className="music-flags">
                        <button
                          type="button"
                          className={`music-flag${form.isDad === true ? ' active' : ''}`}
                          aria-pressed={form.isDad === true}
                          title={form.isDad === null ? 'Not set' : undefined}
                          disabled={busy || detail.status === 'missing'}
                          onClick={() =>
                            setForm({ ...form, isDad: form.isDad !== true })
                          }
                        >
                          Dad music
                        </button>
                        <button
                          type="button"
                          className={`music-flag${form.isMlp === true ? ' active' : ''}`}
                          aria-pressed={form.isMlp === true}
                          title={form.isMlp === null ? 'Not set' : undefined}
                          disabled={busy || detail.status === 'missing'}
                          onClick={() =>
                            setForm({ ...form, isMlp: form.isMlp !== true })
                          }
                        >
                          MLP
                        </button>
                      </div>
                      <Autocomplete
                        multiple
                        freeSolo
                        autoSelect
                        options={[]}
                        value={form.genres}
                        onChange={(_event, values) =>
                          setForm({
                            ...form,
                            genres: [
                              ...new Set(
                                values
                                  .map((name) => name.trim())
                                  .filter(Boolean),
                              ),
                            ],
                          })
                        }
                        renderTags={(values, getTagProps) =>
                          values.map((name, index) => {
                            const {
                              key,
                              onDelete,
                              disabled,
                              tabIndex,
                              className,
                              'data-tag-index': tagIndex,
                            } = getTagProps({ index });
                            return (
                              <Chip
                                key={key}
                                label={name}
                                size="small"
                                onDelete={onDelete}
                                disabled={disabled}
                                tabIndex={tabIndex}
                                className={className}
                                data-tag-index={tagIndex}
                              />
                            );
                          })
                        }
                        renderInput={(params) => (
                          <TextField
                            slotProps={{
                              input: params.InputProps,
                              htmlInput: params.inputProps,
                              inputLabel: params.InputLabelProps,
                            }}
                            disabled={params.disabled}
                            fullWidth={params.fullWidth}
                            id="music-genres"
                            label="Genres"
                            helperText="Type a genre and press Enter to add it."
                            size="small"
                          />
                        )}
                      />
                      <button
                        type="button"
                        className="music-save"
                        disabled={busy || detail.status === 'missing'}
                        onClick={save}
                      >
                        <SaveIcon fontSize="small" /> Save tags
                      </button>
                    </div>
                    <p className="music-path">{detail.path}</p>
                    <div className="music-detail-playlists">
                      <h3>Playlists</h3>
                      {trackPlaylists.length ? (
                        trackPlaylists.map((playlist) => (
                          <button
                            type="button"
                            key={playlist.id}
                            onClick={() => {
                              setSelectedPlaylistId(playlist.id);
                              setView('playlists');
                            }}
                          >
                            {playlist.name}
                          </button>
                        ))
                      ) : (
                        <span>Not in any playlists.</span>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="music-detail-placeholder">
                    <LibraryMusicIcon /> Select a track
                  </div>
                )}
              </section>
            </div>
          </main>
        )}
      </div>
      {(exporting || exportMessage || exportErrors.length > 0) && (
        <section className="music-export" aria-label="File export">
          <div role="status" aria-live="polite">
            {exporting && exportProgress
              ? `Copying files: ${exportProgress.completed} of ${exportProgress.total} processed (${exportProgress.copied} copied, ${exportProgress.failed} failed).`
              : exportMessage}
          </div>
          {exportProgress && (
            <>
              <div>Destination: {exportProgress.destination}</div>
              <progress
                aria-label="File copy progress"
                max={exportProgress.total}
                value={exportProgress.completed}
              />
              {exporting && <div>{exportProgress.currentFile}</div>}
            </>
          )}
          {exportErrors.length > 0 && (
            <div className="music-alert error" role="alert">
              {exportErrors.map((failure) => (
                <div key={`${failure.fileName}:${failure.message}`}>
                  {failure.fileName}: {failure.message}
                </div>
              ))}
            </div>
          )}
          {!exporting && (
            <button
              type="button"
              onClick={() => {
                setExportMessage('');
                setExportErrors([]);
                setExportProgress(null);
              }}
            >
              Dismiss export status
            </button>
          )}
        </section>
      )}
      <MusicPlayer
        ref={playerRef}
        request={playback}
        initialVolume={initialVolume}
        onPlayingTrackChange={setSelectedId}
        onRandomTrack={chooseRandomTrack}
      />
    </div>
  );
}
