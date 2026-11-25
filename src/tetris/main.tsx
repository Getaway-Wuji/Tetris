import { createRoot } from 'react-dom/client';
import '@fontsource-variable/space-grotesk';
import '@fontsource/ibm-plex-mono/500.css';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('tetris-root')!).render(<App />);
