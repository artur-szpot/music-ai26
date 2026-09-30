import { createRoot } from 'react-dom/client';
import MusicApp from './MusicApp';

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(container);
root.render(
  window.music ? (
    <MusicApp />
  ) : (
    <main style={{ padding: 32, fontFamily: 'sans-serif' }}>
      Music Collection requires the Electron desktop window.
    </main>
  ),
);
