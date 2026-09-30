# Music Collection Contributor Notes

The active Electron entrypoints are `src/main/musicMain.ts`, `src/main/musicPreload.ts` and `src/renderer/MusicApp.tsx`. The `.erb` Webpack configurations select them. Do not reintroduce the donor's Minion schema or image modules. The fresh versioned catalog is `data/music/001_initial.sql`, stored at runtime under Electron `userData`.

The main process owns SQLite, scanning, filesystem access and tag writes. Keep renderer input behind the allow-listed typed preload API in `src/constants/musicIpc.ts`. Validate the IPC caller and request in main, confine file access to chosen roots, and parameterize SQL. Write embedded tags only from main, verify the save by rereading, then update the catalog. Do not mark files absent on incomplete or cancelled scans, or delete records just because a root is offline. Use disposable data in tests, never a personal collection.

Use TypeScript strict mode, the repository's two-space/LF/single-quote style, and the existing `release/app/package.json` for production main-process dependencies. Keep `.erb` build plumbing unless a build-specific change is needed. Update the README when architecture or user-visible scope changes.

Run `npm test -- --runInBand`, `npm exec tsc -- --noEmit`, `npm run lint` and `npm run build` for changes; run `npm run package` after resource or runtime dependency changes. Scanner and catalog tests use Node's in-memory `node:sqlite` and temporary folders, requiring Node 22.13+. The tag adapter has also been checked against disposable MP3/FLAC/M4A files on Windows. Packaging on Windows may require Developer Mode/symlink privileges for electron-builder's signing-tool archive. Do not apply any SQL migration to an existing personal collection.
