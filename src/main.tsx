import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { boot } from './state/actions';
import { App } from './ui/App';
import './styles.css';

boot();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
