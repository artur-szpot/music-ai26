# Music Collection

Music Collection is a local Electron app for browsing, searching and editing MP3, FLAC and M4A files in place. On the **Sources** screen, add a music folder with the native picker, wait for its first scan, then select a track in the Library to edit embedded title, artists and genres. Genres appear as editable chips: type a name and press Enter to add one, or remove its chip. The detail panel shows a read-only row of ten rating stars; album, year and track number are hidden and preserved when saving. Rescan rereads embedded tags (including title, artists and rating), finds new files and marks missing files; indexed records remain available when files are missing. Folder scans can be cancelled. The Library lists tracks from every configured folder; choosing a folder, adding folders and rescanning all happen on the dedicated **Sources** screen. Search covers title, artist, album, genre and file path. Library rating filters show 5-star tracks (ratings 9–10), 4-star tracks (7–8), 3-star tracks (5–6), or lower-rated tracks (0–4).

Select a track to edit its **Dad music** and **MLP** badges in the detail panel, then choose **Save tags**. Click a badge to toggle it: faded when off, saturated when on. Unset flags look faded and show a "Not set" tooltip until first toggled. These controls appear only after track details load and are disabled for missing files.

MP3 ratings use the previous app's ten-step POPM mapping, preferring the `no@email` frame. FLAC comments and M4A `com.apple.iTunes` custom tags support `FMPS_RATING` (0–1) and `RATING` (0–100). Missing or unrecognized ratings show no filled stars. The catalog upgrades from versions 1–5 to version 6 automatically to store ratings, artist spelling aliases, playlists, completionist selection history, and playback state; audio files are not modified by ordinary scanning.

Track rows in the Library, Artists and Tags views are highlighted in red when the catalog has no artist, no title (including whitespace-only titles), no genres, or no recognized rating. A stored rating of zero counts as a rating. Save tags or rescan after correcting metadata to refresh the highlighting.

Use **Export files** on a selected playlist to copy its full track list. Choose a destination directory, then confirm the directory and file count before copying starts. Files are copied directly into that directory with their original names and embedded tags; duplicate or existing names receive numbered suffixes such as `song (2).mp3`, never overwriting files. A progress panel stays visible across views and reports processed/copied/failed counts and individual errors, including missing or offline files. Sources and catalog records are unchanged. Scanning and tag writes are blocked during export; finish a scan before exporting.

Track lists display each audio file's name without its extension and show ratings on a five-star scale with half-star steps (a stored rating of 10 shows five full stars). Numbered pagination provides neighboring page choices alongside previous/next controls. Use a track's Play button to start it, or choose **Play random track** to play a random present track from the collection. Whenever a track starts playing or resumes, its properties and playlist links are automatically selected in the Library detail panel, including when a playlist advances or skips unavailable entries. Playback does not switch views; return to the Library to see the panel when playing from Artists, Tags, Playlists or Filter. Tracks restored paused are selected when playback resumes. You can still select another track to inspect or edit it while listening. Create playlists from library tracks, rename or remove playlists, and edit their unique, ordered track lists. Playlist summaries show track count, total duration and average score over rated tracks. Track details link to every playlist containing that track.

The **Filter** view previews present tracks matching text search (title, artist, album, genre or path), selected artists (match any or all), required genres (all selected) and excluded genres (any selected), Dad music and MLP flag selection (any, yes, or no), plus inclusive rating (0–10) and duration-in-minutes ranges. Empty range endpoints are unbounded; setting either rating endpoint excludes unrated tracks. Results are sorted by title (case-insensitive, then catalog ID) and paginated. **Save all as playlist** creates a named playlist from all matching tracks in that order. Missing/offline tracks are excluded. The completionist playlist generator remains a separate random target-length workflow: it selects present tracks not yet used by prior generated playlists, with rating, required/disallowed genre, and target-length filters. Every required genre must be present, and a track with any disallowed genre is excluded. Tracks are selected in random order until the total first exceeds the target; history is recorded when the generated playlist is created, not on playback. When all matching tracks have already been selected, the matching history is reset and the app reports this. Playing a playlist advances in order and skips tracks that are missing or unavailable; single-track playback remains available. A compact player at the bottom stays available across views, with play/pause, stop (rewinds to the start), a seekable progress slider and volume. Pressing Space anywhere outside text fields and interactive controls starts playing the selected track, or pauses/resumes playback when the selected track is the one loaded in the player. The last track, its playback position and the volume are saved in the local catalog; the track and position are restored paused when the app opens. Unavailable files and unsupported codecs report playback errors. Playback uses Electron/Chromium's audio decoder, so codec support depends on the platform.

The **Artists** view lists every distinct artist name with a searchable filter and song count. Select an artist to browse its songs. Correcting a spelling rewrites the embedded artist tag on each affected file without changing its file name, and remembers the variant so future scans can automatically rewrite and verify the corrected tag. Correcting or merging into an existing artist applies immediately; the result appears as a toast in the top-right corner that disappears after a few seconds. File write failures are reported and the variant remains available to correct on a later scan.

The **Tags** view lists only genres with song counts. Select a genre to browse its songs, add a new name, or rename it. Renaming to an existing name merges the tags. For a typo-prone merge source, type part of the name and select the correct fuzzy-match suggestion; the merge applies immediately and reports as a toast. The app writes each affected audio file before updating the catalog; unavailable or changed files remain under the source tag and appear as individual failures. Rescan and retry after resolving them.

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
- [src/main/musicCatalog.ts](src/main/musicCatalog.ts) stores the searchable catalog, persistent artist spelling aliases, ordered playlist membership, completionist selection history, and playback state; generation creates playlists and reserves their track IDs in one transaction. [src/main/musicScanner.ts](src/main/musicScanner.ts) indexes selected folders, corrects recognized artist variants through verified tag writes, and keeps missing-file records.
- [src/main/musicTags.ts](src/main/musicTags.ts) reads and writes embedded tags using `node-taglib-sharp`, with reread verification before the catalog is updated.
- [src/main/musicTagManager.ts](src/main/musicTagManager.ts) applies artist and genre renames/merges through validated file writes and preserves unsuccessful source associations; confirmed artist corrections persist spelling aliases for later scans.
- [src/main/musicExport.ts](src/main/musicExport.ts) collects playlist tracks and copies root-confined audio files without replacing existing destination files. The main process owns destination selection/confirmation and sends copy progress through the allow-listed preload API.
- [src/main/musicPlayback.ts](src/main/musicPlayback.ts) grants an opaque streaming URL only for a catalog track inside its chosen root, revalidates file access on each media request, and forwards byte-range requests for seeking. [src/renderer/MusicPlayer.tsx](src/renderer/MusicPlayer.tsx) owns single-track and ordered playlist playback, advancing or skipping unavailable queue entries; the renderer never requests arbitrary file paths.
- [src/main/musicPreload.ts](src/main/musicPreload.ts) exposes only the methods in [src/constants/musicIpc.ts](src/constants/musicIpc.ts) to [src/renderer/MusicApp.tsx](src/renderer/MusicApp.tsx).

The linked npm `mutagen` package was not used: it is an obsolete wrapper around an external Python installation. The JavaScript metadata library was selected instead. Scans yield between files but still parse metadata on the main process; a worker is needed before large-library responsiveness can be claimed.

This project reuses the Electron build foundation of [minion-2026](https://github.com/artur-szpot/minion-2026). The original Python workflow is in [music-24](https://github.com/artur-szpot/music-24). The donor's MIT license is preserved in [LICENSE](LICENSE).
