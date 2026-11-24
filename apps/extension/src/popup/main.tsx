import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/theme/fonts';
import '../ui/theme/tokens.css';
import '../ui/theme/base.css';
import { Popup } from './Popup';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
