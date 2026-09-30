import { useEffect, useState } from 'react';
import Fuse from 'fuse.js';
import AddIcon from '@mui/icons-material/Add';
import CallMergeIcon from '@mui/icons-material/CallMerge';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { CatalogTag, TagKind, TrackSummary } from '../main/musicCatalog';

const pageSize = 40;

type TagManagerProps = {
  onTrackOpen: (id: number) => void;
  onChanged: () => void;
};

export default function TagManager({
  onTrackOpen,
  onChanged,
}: TagManagerProps) {
  const [kind, setKind] = useState<TagKind>('artist');
  const [tags, setTags] = useState<CatalogTag[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [songs, setSongs] = useState<TrackSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [newTagName, setNewTagName] = useState('');
  const [renameTo, setRenameTo] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [songsLoading, setSongsLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [failures, setFailures] = useState<
    { trackId: number; message: string }[]
  >([]);
  const [pendingMerge, setPendingMerge] = useState<{
    from: CatalogTag;
    destination: string;
  } | null>(null);

  const selected = tags.find(({ id }) => id === selectedId);
  const source = tags.find(({ id }) => id === sourceId);
  const fuzzy = new Fuse(tags, {
    keys: ['name'],
    threshold: 0.45,
    ignoreLocation: true,
  });
  const visibleTags = tagSearch.trim()
    ? fuzzy.search(tagSearch.trim(), { limit: 80 }).map(({ item }) => item)
    : tags;
  const sourceSuggestions = sourceText.trim()
    ? fuzzy
        .search(sourceText.trim(), { limit: 6 })
        .map(({ item }) => item)
        .filter(({ id }) => id !== selectedId)
    : [];

  useEffect(() => {
    let active = true;
    setLoading(true);
    window.music
      .tags(kind)
      .then((result) => {
        if (!active) return undefined;
        if (result.ok) setTags(result.data);
        else setError(result.error.message);
        return undefined;
      })
      .catch(() => {
        if (active) setError('Could not load tags.');
      })
      .finally(() => {
        if (active) setLoading(false);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [kind, revision]);

  useEffect(() => {
    let active = true;
    if (selectedId === null) {
      setSongs([]);
      setTotal(0);
      return () => {
        active = false;
      };
    }
    setSongsLoading(true);
    window.music
      .tagSongs(kind, selectedId, pageSize, page * pageSize)
      .then((result) => {
        if (!active) return undefined;
        if (result.ok) {
          setSongs(result.data.rows);
          setTotal(result.data.total);
        } else setError(result.error.message);
        return undefined;
      })
      .catch(() => {
        if (active) setError('Could not load songs for this tag.');
      })
      .finally(() => {
        if (active) setSongsLoading(false);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [kind, selectedId, page, revision]);

  const changeKind = (value: TagKind) => {
    setKind(value);
    setSelectedId(null);
    setSourceId(null);
    setSourceText('');
    setRenameTo('');
    setTagSearch('');
    setPage(0);
    setError('');
    setMessage('');
    setFailures([]);
    setPendingMerge(null);
  };

  const addTag = async () => {
    if (!newTagName.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.music.addTag(kind, newTagName.trim());
      if (!result.ok) throw new Error(result.error.message);
      setSelectedId(result.data.id);
      setPage(0);
      setNewTagName('');
      setMessage(`${result.data.name} added.`);
      setRevision((value) => value + 1);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add tag.');
    } finally {
      setBusy(false);
    }
  };

  const move = async (from: CatalogTag, to: string) => {
    const destination = to.trim();
    if (
      !destination ||
      from.name.toLocaleLowerCase() === destination.toLocaleLowerCase()
    )
      return;
    setBusy(true);
    setError('');
    setFailures([]);
    try {
      const result = await window.music.moveTag(kind, from.id, destination);
      if (!result.ok) throw new Error(result.error.message);
      const { destinationId, updated, remaining, errors } = result.data;
      setSelectedId(destinationId);
      setPage(0);
      setRenameTo('');
      setSourceText('');
      setSourceId(null);
      setFailures(errors);
      setMessage(
        remaining
          ? `${updated} songs updated; ${remaining} still use ${from.name}.`
          : `${from.name} updated across ${updated} songs.`,
      );
      setRevision((value) => value + 1);
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not update tag.',
      );
    } finally {
      setBusy(false);
    }
  };

  const requestMove = (from: CatalogTag, to: string) => {
    const destination = to.trim();
    if (
      !destination ||
      from.name.toLocaleLowerCase() === destination.toLocaleLowerCase()
    )
      return;
    const existing = tags.find(
      ({ name }) =>
        name.toLocaleLowerCase() === destination.toLocaleLowerCase(),
    );
    if (existing) setPendingMerge({ from, destination: existing.name });
    else move(from, destination);
  };

  return (
    <main className="tag-manager">
      <header className="music-toolbar">
        <h1>Tags</h1>
        <div className="tag-kinds" role="group" aria-label="Tag kind">
          <button
            type="button"
            className={kind === 'artist' ? 'active' : ''}
            aria-pressed={kind === 'artist'}
            onClick={() => changeKind('artist')}
          >
            Artists
          </button>
          <button
            type="button"
            className={kind === 'genre' ? 'active' : ''}
            aria-pressed={kind === 'genre'}
            onClick={() => changeKind('genre')}
          >
            Genres
          </button>
        </div>
      </header>
      {(message || error) && (
        <div
          className={error ? 'music-alert error' : 'music-alert'}
          role="status"
        >
          {error || message}
        </div>
      )}
      {failures.length > 0 && (
        <div className="tag-failures" role="alert">
          {failures.map(({ trackId, message: failure }) => (
            <div key={trackId}>
              Song #{trackId}: {failure}
            </div>
          ))}
        </div>
      )}
      {pendingMerge && (
        <div
          className="tag-confirm"
          role="alertdialog"
          aria-label="Confirm tag merge"
        >
          <span>
            Merge {pendingMerge.from.name} into {pendingMerge.destination}?
          </span>
          <button type="button" onClick={() => setPendingMerge(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="tag-confirm-action"
            onClick={() => {
              const { from, destination } = pendingMerge;
              setPendingMerge(null);
              move(from, destination);
            }}
          >
            Confirm merge
          </button>
        </div>
      )}
      <div className="tag-layout">
        <section
          className="tag-directory"
          aria-label={`${kind === 'artist' ? 'Artist' : 'Genre'} tags`}
        >
          <label className="tag-filter" htmlFor="tag-filter">
            <SearchIcon fontSize="small" />
            <input
              id="tag-filter"
              type="search"
              placeholder="Find a tag"
              value={tagSearch}
              onChange={(event) => setTagSearch(event.target.value)}
            />
          </label>
          <div className="tag-directory-list">
            {loading && <p className="music-empty">Loading...</p>}
            {!loading && visibleTags.length === 0 && (
              <p className="music-empty">No tags found.</p>
            )}
            {!loading &&
              visibleTags.map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  className={`tag-row${selectedId === tag.id ? ' selected' : ''}`}
                  onClick={() => {
                    setSelectedId(tag.id);
                    setPage(0);
                    setRenameTo('');
                    setSourceId(null);
                    setPendingMerge(null);
                  }}
                >
                  <span>{tag.name}</span>
                  <small>{tag.track_count}</small>
                </button>
              ))}
          </div>
          <div className="tag-add">
            <label htmlFor="new-tag">New {kind}</label>
            <div className="tag-inline">
              <input
                id="new-tag"
                maxLength={200}
                value={newTagName}
                onChange={(event) => setNewTagName(event.target.value)}
              />
              <button
                type="button"
                title="Add tag"
                aria-label="Add tag"
                disabled={busy || !newTagName.trim()}
                onClick={addTag}
              >
                <AddIcon fontSize="small" />
              </button>
            </div>
          </div>
        </section>
        <section className="tag-songs" aria-label="Songs with selected tag">
          <div className="tag-section-heading">
            <h2>{selected?.name ?? 'Select a tag'}</h2>
            <span>{selected ? `${total} songs` : ''}</span>
          </div>
          {songsLoading && <p className="music-empty">Loading...</p>}
          {!songsLoading && songs.length === 0 && (
            <p className="music-empty">
              {selected
                ? 'No songs use this tag.'
                : 'Select a tag to view its songs.'}
            </p>
          )}
          {!songsLoading &&
            songs.map((song) => (
              <button
                type="button"
                className="tag-song-row"
                key={song.id}
                onClick={() => onTrackOpen(song.id)}
              >
                <span>
                  {song.title || song.path.split(/[\\/]/).pop()}
                  {song.status === 'missing' && <small>Missing</small>}
                </span>
                <small>{song.album}</small>
              </button>
            ))}
          {selected && total > pageSize && (
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
                {page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)}{' '}
                of {total}
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
          )}
        </section>
        <section className="tag-actions" aria-label="Tag actions">
          {selected ? (
            <>
              <h2>Edit tag</h2>
              <label htmlFor="rename-tag">
                Name
                <input
                  id="rename-tag"
                  value={renameTo}
                  maxLength={200}
                  placeholder={selected.name}
                  onChange={(event) => setRenameTo(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="music-save"
                disabled={
                  busy ||
                  !renameTo.trim() ||
                  renameTo.trim().toLocaleLowerCase() ===
                    selected.name.toLocaleLowerCase()
                }
                onClick={() => requestMove(selected, renameTo)}
              >
                <EditIcon fontSize="small" />
                {tags.some(
                  ({ id, name }) =>
                    id !== selected.id &&
                    name.toLocaleLowerCase() ===
                      renameTo.trim().toLocaleLowerCase(),
                )
                  ? 'Merge into existing'
                  : 'Rename'}
              </button>
              <div className="tag-merge">
                <h2>Merge into {selected.name}</h2>
                <label htmlFor="merge-source">
                  Source tag
                  <input
                    id="merge-source"
                    value={sourceText}
                    maxLength={200}
                    onChange={(event) => {
                      setSourceText(event.target.value);
                      setSourceId(null);
                    }}
                  />
                </label>
                {sourceSuggestions.length > 0 && (
                  <div
                    className="tag-suggestions"
                    role="listbox"
                    aria-label="Matching tags"
                  >
                    {sourceSuggestions.map((suggestion) => (
                      <button
                        type="button"
                        key={suggestion.id}
                        role="option"
                        aria-selected={sourceId === suggestion.id}
                        onClick={() => {
                          setSourceId(suggestion.id);
                          setSourceText(suggestion.name);
                        }}
                      >
                        {suggestion.name}{' '}
                        <small>{suggestion.track_count} songs</small>
                      </button>
                    ))}
                  </div>
                )}
                {source && (
                  <p className="tag-source-confirmation">
                    Source: {source.name}
                  </p>
                )}
                <button
                  type="button"
                  className="music-save"
                  disabled={busy || !source || source.id === selected.id}
                  onClick={() => {
                    if (source) requestMove(source, selected.name);
                  }}
                >
                  <CallMergeIcon fontSize="small" /> Merge tags
                </button>
              </div>
            </>
          ) : (
            <p className="music-empty">Select a tag to edit it.</p>
          )}
        </section>
      </div>
    </main>
  );
}
