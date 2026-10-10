import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './features.css';
import './welcome.css';
import './git-compare.css';
import './more.css';

createRoot(document.getElementById('root')!).render(<App />);
