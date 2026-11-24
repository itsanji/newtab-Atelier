import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SyncStatusLine } from './SyncStatus';

describe('SyncStatus', () => {
  test.each([
    ['idle', 'Synced'],
    ['syncing', 'Syncing…'],
    ['offline', 'Offline'],
  ] as const)('renders %s', (state, text) => {
    render(<SyncStatusLine state={state} onSignIn={() => {}} onRetry={() => {}} />);
    expect(screen.getByRole('status').textContent).toBe(text);
  });

  test('paused offers to sign in again', () => {
    const onSignIn = vi.fn();
    render(<SyncStatusLine state="paused" onSignIn={onSignIn} onRetry={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sync paused — sign in again' }));
    expect(onSignIn).toHaveBeenCalled();
  });

  test('error offers retry', () => {
    const onRetry = vi.fn();
    render(<SyncStatusLine state="error" onSignIn={() => {}} onRetry={onRetry} />);
    expect(screen.getByRole('status').textContent).toContain('Sync failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
