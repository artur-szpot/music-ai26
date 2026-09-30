import { useEffect, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import AddIcon from '@mui/icons-material/Add';
import CallMergeIcon from '@mui/icons-material/CallMerge';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import type { CatalogTag, TagKind, TrackSummary } from '../main/musicCatalog';
import MusicPagination from './MusicPagination';
import TrackRow from './TrackRow';

const pageSize = 40;

type TagManagerProps = {
  kind: TagKind;
  onTrackOpen: (id: number) => void;
  onChanged: () => void;
  onTrackPlay: (track: TrackSummary) => void;
};

export default function TagManager({
  kind,
  onTrackOpen,
  onChanged,
  onTrackPlay,
}: TagManagerProps) {
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
  const [destinationText, setDestinationText] = useState('');
  const [destinationId, setDestinationId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [songsLoading, setSongsLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [failures, setFailures] = useState<
    { trackId: number; message: string }[]
  >([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemName = kind === 'artist' ? 'artist' : 'tag';
  const pluralName = kind === 'artist' ? 'artists' : 'tags';

  const selected = tags.find(({ id }) => id === selectedId);
  const source = tags.find(({ id }) => id === sourceId);
  const destinationTag = tags.find(({ id }) => id === destinationId);
  const fuzzy = new Fuse(tags, {
    keys: ['name'],
    threshold: 0.45,
    ignoreLocation: true,
  });
  const visibleTags = tagSearch.trim()
    ? fuzzy.search(tagSearch.trim()).map(({ item }) => item)
    : tags;
  const mergeSuggestions = (text: string) =>
    text.trim()
      ? fuzzy
          .search(text.trim())
          .map(({ item }) => item)
          .filter(({ id }) => id !== selectedId)
          .slice(0, 6)
      : [];
  const sourceSuggestions = mergeSuggestions(sourceText);
  const destinationSuggestions = mergeSuggestions(destinationText);
  const isExistingRenameTarget = tags.some(
    ({ id, name }) =>
      id !== selectedId &&
      name.toLocaleLowerCase() === renameTo.trim().toLocaleLowerCase(),
  );
  let renameLabel = kind === 'artist' ? 'Correct artist' : 'Rename';
  if (isExistingRenameTarget) renameLabel = 'Merge into existing';

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
        if (active)
          setError(
            kind === 'artist'
              ? 'Could not load artists.'
              : 'Could not load tags.',
          );
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
        if (active)
          setError(
            kind === 'artist'
              ? 'Could not load songs for this artist.'
              : 'Could not load songs for this tag.',
          );
      })
      .finally(() => {
        if (active) setSongsLoading(false);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [kind, selectedId, page, revision]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const showToast = (text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setMessage(text);
    toastTimer.current = setTimeout(() => {
      setMessage('');
      toastTimer.current = null;
    }, 5000);
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
      setDestinationText('');
      setDestinationId(null);
      showToast(`${result.data.name} added.`);
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
      const {
        destinationId: mergedId,
        updated,
        remaining,
        errors,
      } = result.data;
      setSelectedId(mergedId);
      setPage(0);
      setRenameTo(destination);
      setSourceText('');
      setSourceId(null);
      setDestinationText('');
      setDestinationId(null);
      setFailures(errors);
      showToast(
        remaining
          ? `${updated} songs updated; ${remaining} still use ${from.name}.`
          : `${from.name} updated across ${updated} songs.`,
      );
      setRevision((value) => value + 1);
      onChanged();
    } catch (cause) {
      const fallbackError =
        kind === 'artist'
          ? 'Could not update artist.'
          : 'Could not update tag.';
      setError(cause instanceof Error ? cause.message : fallbackError);
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
    move(from, destination);
  };

  return (
    <main className="tag-manager">
      <header className="music-toolbar">
        <h1>{kind === 'artist' ? 'Artists' : 'Tags'}</h1>
      </header>
      {error && (
        <div className="music-alert error" role="status">
          {error}
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
      {message && (
        <div className="music-toast" role="status">
          {message}
        </div>
      )}
      <div className="tag-layout">
        <section
          className="tag-directory"
          aria-label={kind === 'artist' ? 'Artists' : 'Genre tags'}
        >
          <label className="tag-filter" htmlFor="tag-filter">
            <SearchIcon fontSize="small" />
            <input
              id="tag-filter"
              type="search"
              placeholder={`Find ${pluralName}`}
              value={tagSearch}
              onChange={(event) => setTagSearch(event.target.value)}
            />
          </label>
          <div className="tag-directory-list">
            {loading && <p className="music-empty">Loading...</p>}
            {!loading && visibleTags.length === 0 && (
              <p className="music-empty">No {pluralName} found.</p>
            )}
            {!loading &&
              visibleTags.map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  className={`tag-row${selectedId === tag.id ? ' selected' : ''}`}
                  disabled={busy}
                  onClick={() => {
                    setSelectedId(tag.id);
                    setPage(0);
                    setRenameTo(tag.name);
                    setSourceId(null);
                    setDestinationId(null);
                    setDestinationText('');
                  }}
                >
                  <span>{tag.name}</span>
                  <small>{tag.track_count}</small>
                </button>
              ))}
          </div>
          {kind === 'genre' && (
            <div className="tag-add">
              <span>New genre</span>
              <div className="tag-inline">
                <input
                  id="new-tag"
                  aria-label="New genre"
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
          )}
        </section>
        <section
          className="tag-songs"
          aria-label={`Songs with selected ${itemName}`}
        >
          <div className="tag-section-heading">
            <h2>{selected?.name ?? `Select an ${itemName}`}</h2>
            <span>{selected ? `${total} songs` : ''}</span>
          </div>
          {songsLoading && <p className="music-empty">Loading...</p>}
          {!songsLoading && songs.length === 0 && (
            <p className="music-empty">
              {selected
                ? `No songs use this ${itemName}.`
                : `Select an ${itemName} to view its songs.`}
            </p>
          )}
          {!songsLoading &&
            songs.map((song) => (
              <TrackRow
                key={song.id}
                track={song}
                compact
                onOpen={onTrackOpen}
                onPlay={onTrackPlay}
              />
            ))}
          {selected && total > pageSize && (
            <MusicPagination
              page={page}
              pageSize={pageSize}
              total={total}
              itemLabel={kind === 'artist' ? 'Artist songs' : 'Tag songs'}
              onPageChange={setPage}
            />
          )}
        </section>
        <section
          className="tag-actions"
          aria-label={`${itemName[0].toUpperCase()}${itemName.slice(1)} actions`}
        >
          {selected ? (
            <>
              <h2>{kind === 'artist' ? 'Correct artist name' : 'Edit tag'}</h2>
              {kind === 'artist' && (
                <p className="tag-source-confirmation">
                  Corrections update embedded artist tags and remember the
                  previous spelling for future scans. File names are unchanged.
                </p>
              )}
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
                {renameLabel}
              </button>
              <div className="tag-merge">
                <h2>Merge into...</h2>
                <label htmlFor="merge-destination">
                  Destination {itemName}
                  <input
                    id="merge-destination"
                    value={destinationText}
                    maxLength={200}
                    disabled={busy}
                    onChange={(event) => {
                      setDestinationText(event.target.value);
                      setDestinationId(null);
                    }}
                  />
                </label>
                {destinationSuggestions.length > 0 && (
                  <div
                    className="tag-suggestions"
                    role="listbox"
                    aria-label="Matching destination tags"
                  >
                    {destinationSuggestions.map((suggestion) => (
                      <button
                        type="button"
                        key={suggestion.id}
                        role="option"
                        aria-selected={destinationId === suggestion.id}
                        disabled={busy}
                        onClick={() => {
                          setDestinationId(suggestion.id);
                          setDestinationText(suggestion.name);
                        }}
                      >
                        {suggestion.name}{' '}
                        <small>{suggestion.track_count} songs</small>
                      </button>
                    ))}
                  </div>
                )}
                {destinationTag && (
                  <p className="tag-source-confirmation">
                    Destination: {destinationTag.name}
                  </p>
                )}
                <button
                  type="button"
                  className="music-save"
                  disabled={
                    busy || !destinationTag || destinationTag.id === selected.id
                  }
                  onClick={() => {
                    if (destinationTag)
                      requestMove(selected, destinationTag.name);
                  }}
                >
                  <CallMergeIcon fontSize="small" /> Merge into selected{' '}
                  {itemName}
                </button>
              </div>
              <div className="tag-merge">
                <h2>Merge into {selected.name}</h2>
                <label htmlFor="merge-source">
                  Source {itemName}
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
                    aria-label={`Matching ${pluralName}`}
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
                  <CallMergeIcon fontSize="small" /> Merge {pluralName}
                </button>
              </div>
            </>
          ) : (
            <p className="music-empty">Select an {itemName} to edit it.</p>
          )}
        </section>
      </div>
    </main>
  );
}
