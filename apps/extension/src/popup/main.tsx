import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyCachedTheme } from '../data/settings';
import { requestSyncOnLocalWrite } from '../sync/localWrites';
import { ErrorBoundary } from '../ui/components/ErrorBoundary';
import '../ui/theme/fonts';
import '../ui/theme/tokens.css';
import '../ui/theme/base.css';
import '../board/board.css';
import { Popup } from './Popup';

applyCachedTheme();
requestSyncOnLocalWrite();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Popup />
    </ErrorBoundary>
  </StrictMode>,
);
