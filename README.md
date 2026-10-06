# Music Collection

Music Collection is a local Electron app for browsing, searching and editing MP3, FLAC and M4A files in place. Add a music folder with the native picker, wait for its first scan, then select a track to edit embedded title, artists and genres. Genres appear as editable chips: type a name and press Enter to add one, or remove its chip. The detail panel shows a read-only row of ten rating stars; album, year and track number are hidden and preserved when saving. Rescan rereads embedded tags (including title, artists and rating), finds new files and marks missing files; indexed records remain available when files are missing. Folder scans can be cancelled. Search covers title, artist, album, genre and file path.

MP3 ratings use the previous app's ten-step POPM mapping, preferring the `no@email` frame. FLAC comments and M4A `com.apple.iTunes` custom tags support `FMPS_RATING` (0–1) and `RATING` (0–100). Missing or unrecognized ratings show no filled stars. The catalog upgrades from version 1 to version 2 automatically to store ratings; audio files are not modified by scanning.

Track rows in the Library and Tags views are highlighted in red when the catalog has no artist, no title (including whitespace-only titles), no genres, or no recognized rating. A stored rating of zero counts as a rating. Save tags or rescan after correcting metadata to refresh the highlighting.

Track lists show ratings on a five-star scale with half-star steps (a stored rating of 10 shows five full stars). Use a track's Play button to start it without opening its details. A compact player at the bottom stays available across views, with play/pause, stop (rewinds to the start), a seekable progress slider and volume. Missing tracks cannot be started; unavailable files and unsupported codecs report playback errors. Playback uses Electron/Chromium's audio decoder, so codec support depends on the platform.

The **Tags** view lists only genres with song counts; artists are track metadata, not tags in this view. Select a genre to browse its songs, add a new name, or rename it. Renaming to an existing name merges the tags. For a typo-prone merge source, type part of the name, select the correct fuzzy-match suggestion, and confirm the merge. The app writes each affected audio file before updating the catalog; unavailable or changed files remain under the source tag and appear as individual failures. Rescan and retry after resolving them.

Tag details support both merge directions: choose a source under **Merge into [current tag]**, or choose a destination under **Merge into...** to move the current genre into another. Both require explicitly selecting an existing genre from fuzzy suggestions and confirming the source and destination before writing files.

The catalog is a new SQLite database under Electron's per-user `userData` directory, named `music-catalog.db`. Its versioned baseline is [data/music/001_initial.sql](data/music/001_initial.sql). The app never moves source audio or imports the old `music-24` JSON database. Do not apply the old Minion schema to a music collection.

## Development

Use Node.js 22.13 or newer and npm. Install dependencies and launch Electron:

```sh
npm install
npm start
```

The renderer development server normally uses port 60606. It is the renderer portion of the Electron app; open the Electron window to use filesystem features. `npm run build` builds the main, preload and renderer. `npm run package` packages for the current platform. On Windows, electron-builder may require Developer Mode or symlink privileges to unpack its code-signing tools even for an unsigned installer.

During development, a reload can interrupt the initial page load (`ERR_ABORTED`). Startup waits for the replacement navigation to finish instead of quitting. Other navigation failures and a 30-second loading timeout still report an error.

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
- [src/main/musicTagManager.ts](src/main/musicTagManager.ts) applies artist and genre renames/merges through validated file writes and preserves unsuccessful source associations.
- [src/main/musicPlayback.ts](src/main/musicPlayback.ts) grants an opaque streaming URL only for a catalog track inside its chosen root, revalidates file access on each media request, and forwards byte-range requests for seeking. [src/renderer/MusicPlayer.tsx](src/renderer/MusicPlayer.tsx) owns audio playback and the bottom controls; the renderer never requests arbitrary file paths.
- [src/main/musicPreload.ts](src/main/musicPreload.ts) exposes only the methods in [src/constants/musicIpc.ts](src/constants/musicIpc.ts) to [src/renderer/MusicApp.tsx](src/renderer/MusicApp.tsx).

The linked npm `mutagen` package was not used: it is an obsolete wrapper around an external Python installation. The JavaScript metadata library was selected instead. Playlists (editable queues) and export/copy are planned but not implemented. Scans yield between files but still parse metadata on the main process; a worker is needed before large-library responsiveness can be claimed.

This project reuses the Electron build foundation of [minion-2026](https://github.com/artur-szpot/minion-2026). The original Python workflow is in [music-24](https://github.com/artur-szpot/music-24). The donor's MIT license is preserved in [LICENSE](LICENSE).
