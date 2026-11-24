import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/theme/fonts';
import '../ui/theme/tokens.css';
import '../ui/theme/base.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
