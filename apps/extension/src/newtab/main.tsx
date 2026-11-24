import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyCachedTheme } from '../data/settings';
import '../ui/theme/fonts';
import '../ui/theme/tokens.css';
import '../ui/theme/base.css';
import '../board/board.css';
import { App } from './App';

applyCachedTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
