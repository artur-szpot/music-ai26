# Music Collection

Music Collection is a local Electron app for browsing, searching and editing MP3, FLAC and M4A files in place. Add a music folder with the native picker, wait for its first scan, then select a track to edit embedded title, artists, album, genres, year or track number. Rescan to find new files or mark missing files; indexed records remain available when files are missing. Folder scans can be cancelled. Search covers title, artist, album, genre and file path.

The catalog is a new SQLite database under Electron's per-user `userData` directory, named `music-catalog.db`. Its versioned baseline is [data/music/001_initial.sql](data/music/001_initial.sql). The app never moves source audio or imports the old `music-24` JSON database. Do not apply the old Minion schema to a music collection.

## Development

Use Node.js 22.13 or newer and npm. Install dependencies and launch Electron:

```sh
npm install
npm start
```

The renderer development server normally uses port 666. It is the renderer portion of the Electron app; open the Electron window to use filesystem features. `npm run build` builds the main, preload and renderer. `npm run package` packages for the current platform. On Windows, electron-builder may require Developer Mode or symlink privileges to unpack its code-signing tools even for an unsigned installer.

Validation:

```sh
npm test -- --runInBand
npm exec tsc -- --noEmit
npm run lint
npm run build
```

The SQLite integration tests use Node's experimental `node:sqlite` API. The production app uses Electron's rebuilt `better-sqlite3`. Tests scan disposable directories and do not touch your music. No personal configuration or audio files belong in the repository.

## Architecture

- [src/main/musicMain.ts](src/main/musicMain.ts) owns the window, user-data SQLite database, trusted IPC and validated file edits.
- [src/main/musicCatalog.ts](src/main/musicCatalog.ts) stores the searchable catalog; [src/main/musicScanner.ts](src/main/musicScanner.ts) indexes selected folders and keeps missing-file records.
- [src/main/musicTags.ts](src/main/musicTags.ts) reads and writes embedded tags using `node-taglib-sharp`, with reread verification before the catalog is updated.
- [src/main/musicPreload.ts](src/main/musicPreload.ts) exposes only the methods in [src/constants/musicIpc.ts](src/constants/musicIpc.ts) to [src/renderer/MusicApp.tsx](src/renderer/MusicApp.tsx).

The linked npm `mutagen` package was not used: it is an obsolete wrapper around an external Python installation. The JavaScript metadata library was selected instead. Playlists (editable queues), playback and export/copy are planned but not implemented. Scans yield between files but still parse metadata on the main process; a worker is needed before large-library responsiveness can be claimed.

This project reuses the Electron build foundation of [minion-2026](https://github.com/artur-szpot/minion-2026). The original Python workflow is in [music-24](https://github.com/artur-szpot/music-24). The donor's MIT license is preserved in [LICENSE](LICENSE).
