import { useDeferredValue, useEffect, useState } from 'react';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import StopIcon from '@mui/icons-material/Stop';
import SaveIcon from '@mui/icons-material/Save';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import type { TrackDetail, TrackSummary } from '../main/musicCatalog';
import './MusicApp.css';

type TagForm = {
  title: string;
  album: string;
  artists: string;
  genres: string;
  year: string;
  track: string;
};

const pageSize = 40;

const editForm = (track: TrackDetail): TagForm => ({
  title: track.title,
  album: track.album,
  artists: track.artists.join('\n'),
  genres: track.genres.join('\n'),
  year: track.year ? String(track.year) : '',
  track: track.track_number ? String(track.track_number) : '',
});

function duration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function MusicApp() {
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
  const [form, setForm] = useState<TagForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
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
      .search(deferredQuery, pageSize, page * pageSize)
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
  }, [deferredQuery, page, revision]);

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

  const scan = async (rootId: number) => {
    setBusy(true);
    setError('');
    setMessage('Scanning music folder...');
    try {
      const result = await window.music.scan(rootId);
      if (!result.ok) throw new Error(result.error.message);
      const { addedOrUpdated, failed, missing, cancelled } = result.data;
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
        album: form.album.trim(),
        artists: form.artists
          .split('\n')
          .map((name) => name.trim())
          .filter(Boolean),
        genres: form.genres
          .split('\n')
          .map((name) => name.trim())
          .filter(Boolean),
        year: Number(form.year),
        track: Number(form.track),
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

  return (
    <div className="music-app">
      <aside className="music-sidebar">
        <div className="music-brand">
          <LibraryMusicIcon /> <span>Music Collection</span>
        </div>
        <div className="music-sidebar-section">
          <label htmlFor="root-select">
            Folders
            <select
              id="root-select"
              value={activeRoot ?? ''}
              onChange={(event) => setActiveRoot(Number(event.target.value))}
            >
              {roots.length === 0 && <option value="">No folders</option>}
              {roots.map(({ id, root_path: rootPath }) => (
                <option key={id} value={id}>
                  {rootPath}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="music-command"
            onClick={chooseRoot}
            disabled={busy}
          >
            <FolderOpenIcon fontSize="small" /> Add folder
          </button>
          {activeRoot !== null && (
            <button
              type="button"
              className="music-command"
              disabled={busy}
              onClick={() => scan(activeRoot)}
            >
              <RefreshIcon fontSize="small" /> Rescan
            </button>
          )}
          {busy && (
            <button
              type="button"
              className="music-command"
              onClick={() => window.music.cancelScan()}
            >
              <StopIcon fontSize="small" /> Cancel scan
            </button>
          )}
        </div>
        <div className="music-sidebar-footer">{total} tracks</div>
      </aside>
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
              <span>Album</span>
              <span>Length</span>
            </div>
            {loading && <p className="music-empty">Loading...</p>}
            {!loading && rows.length === 0 && (
              <p className="music-empty">
                {roots.length ? 'No matching tracks.' : 'No music folders yet.'}
              </p>
            )}
            {!loading &&
              rows.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  className={`music-row${selectedId === row.id ? ' selected' : ''}`}
                >
                  <span className="music-title">
                    {row.title || row.path.split(/[\\/]/).pop()}
                    {row.status === 'missing' && <small>Missing</small>}
                  </span>
                  <span className="music-album">{row.album}</span>
                  <span className="music-length">
                    {duration(row.duration_ms)}
                  </span>
                </button>
              ))}
            <div className="music-pagination">
              <button
                type="button"
                title="Previous page"
                aria-label="Previous page"
                disabled={page === 0}
                onClick={() => setPage((value) => value - 1)}
              >
                <ChevronLeftIcon fontSize="small" />
              </button>
              <span>
                {total
                  ? `${page * pageSize + 1}-${Math.min((page + 1) * pageSize, total)} of ${total}`
                  : '0 tracks'}
              </span>
              <button
                type="button"
                title="Next page"
                aria-label="Next page"
                disabled={(page + 1) * pageSize >= total}
                onClick={() => setPage((value) => value + 1)}
              >
                <ChevronRightIcon fontSize="small" />
              </button>
            </div>
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
                  <label htmlFor="music-album">
                    Album
                    <input
                      id="music-album"
                      value={form.album}
                      onChange={(event) =>
                        setForm({ ...form, album: event.target.value })
                      }
                    />
                  </label>
                  <label htmlFor="music-genres">
                    Genres
                    <textarea
                      id="music-genres"
                      rows={2}
                      value={form.genres}
                      onChange={(event) =>
                        setForm({ ...form, genres: event.target.value })
                      }
                    />
                  </label>
                  <div className="music-form-pair">
                    <label htmlFor="music-year">
                      Year
                      <input
                        id="music-year"
                        type="number"
                        min="0"
                        max="3000"
                        value={form.year}
                        onChange={(event) =>
                          setForm({ ...form, year: event.target.value })
                        }
                      />
                    </label>
                    <label htmlFor="music-track">
                      Track
                      <input
                        id="music-track"
                        type="number"
                        min="0"
                        max="3000"
                        value={form.track}
                        onChange={(event) =>
                          setForm({ ...form, track: event.target.value })
                        }
                      />
                    </label>
                  </div>
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
              </>
            ) : (
              <div className="music-detail-placeholder">
                <LibraryMusicIcon /> Select a track
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
