BEGIN;

CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  root_path TEXT NOT NULL UNIQUE,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tracks (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  path TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL CHECK (format IN ('mp3', 'flac', 'm4a')),
  size_bytes INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  title TEXT NOT NULL,
  album TEXT NOT NULL,
  duration_ms REAL NOT NULL,
  year INTEGER NOT NULL DEFAULT 0,
  track_number INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'missing')),
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX tracks_source_status ON tracks(source_id, status);
CREATE INDEX tracks_title ON tracks(title COLLATE NOCASE);
CREATE INDEX tracks_album ON tracks(album COLLATE NOCASE);

CREATE TABLE artists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0)
);

CREATE TABLE track_artists (
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id),
  position INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'original',
  PRIMARY KEY (track_id, position)
);

CREATE INDEX track_artists_artist ON track_artists(artist_id);

CREATE TABLE genres (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0)
);

CREATE TABLE track_genres (
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  genre_id INTEGER NOT NULL REFERENCES genres(id),
  PRIMARY KEY (track_id, genre_id)
);

CREATE INDEX track_genres_genre ON track_genres(genre_id);

PRAGMA user_version = 1;
COMMIT;