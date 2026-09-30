import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import RefreshIcon from '@mui/icons-material/Refresh';
import StopIcon from '@mui/icons-material/Stop';

type SourcesManagerProps = {
  roots: { id: number; root_path: string }[];
  activeRoot: number | null;
  busy: boolean;
  message: string;
  error: string;
  scanErrors: { fileName: string; message: string }[];
  onSelectRoot: (id: number) => void;
  onAddFolder: () => void;
  onRescan: (rootId: number) => void;
  onCancelScan: () => void;
};

export default function SourcesManager({
  roots,
  activeRoot,
  busy,
  message,
  error,
  scanErrors,
  onSelectRoot,
  onAddFolder,
  onRescan,
  onCancelScan,
}: SourcesManagerProps) {
  return (
    <main className="music-main">
      <header className="music-toolbar">
        <h1>Library sources</h1>
      </header>
      {(message || error) && (
        <div
          className={error ? 'music-alert error' : 'music-alert'}
          role="status"
        >
          {error || message}
        </div>
      )}
      {scanErrors.length > 0 && (
        <div className="music-alert error" role="alert">
          {scanErrors.map(({ fileName, message: scanError }) => (
            <div key={`${fileName}:${scanError}`}>
              {fileName}: {scanError}
            </div>
          ))}
        </div>
      )}
      <section className="music-sources" aria-label="Music folders">
        <label htmlFor="root-select">
          Chosen folder
          <select
            id="root-select"
            value={activeRoot ?? ''}
            onChange={(event) => onSelectRoot(Number(event.target.value))}
          >
            {roots.length === 0 && <option value="">No folders</option>}
            {roots.map(({ id, root_path: rootPath }) => (
              <option key={id} value={id}>
                {rootPath}
              </option>
            ))}
          </select>
        </label>
        <div className="music-sources-actions">
          <button type="button" onClick={onAddFolder} disabled={busy}>
            <FolderOpenIcon fontSize="small" /> Add folder
          </button>
          {activeRoot !== null && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRescan(activeRoot)}
            >
              <RefreshIcon fontSize="small" /> Rescan
            </button>
          )}
          {busy && (
            <button type="button" onClick={onCancelScan}>
              <StopIcon fontSize="small" /> Cancel scan
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
