import { beforeEach, describe, expect, test } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { getTheme, resolveTheme, setTheme, useTheme } from './settings';
import { installChromeFake, type ChromeFake } from '../../test/chromeFake';

function mockMedia(dark: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    get matches() { return dark; },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  window.matchMedia = (() => mql) as unknown as typeof window.matchMedia;
  return { flip(next: boolean) { dark = next; listeners.forEach((l) => l()); } };
}

beforeEach(() => {
  installChromeFake();
  localStorage.clear();
  document.documentElement.className = '';
  mockMedia(false);
});

describe('settings', () => {
  test('defaults to system and resolves by prefers-color-scheme', async () => {
    expect(await getTheme()).toBe('system');
    expect(resolveTheme('system', true)).toBe('nocturne');
    expect(resolveTheme('system', false)).toBe('giverny');
    expect(resolveTheme('giverny', true)).toBe('giverny');
    expect(resolveTheme('nocturne', false)).toBe('nocturne');
  });

  test('setTheme persists', async () => {
    await setTheme('nocturne');
    expect(await getTheme()).toBe('nocturne');
  });

  test('useTheme applies the class, caches it, and follows system changes', async () => {
    const media = mockMedia(true);
    renderHook(() => useTheme());
    await waitFor(() => expect(document.documentElement).toHaveClass('nocturne'));
    expect(localStorage.getItem('atelier-theme')).toBe('nocturne');
    act(() => media.flip(false));
    await waitFor(() => expect(document.documentElement).toHaveClass('giverny'));
    expect(document.documentElement).not.toHaveClass('nocturne');
  });

  test('cycle goes giverny, nocturne, system and persists', async () => {
    await setTheme('giverny');
    const { result } = renderHook(() => useTheme());
    await waitFor(() => expect(result.current.pref).toBe('giverny'));
    await act(async () => { await result.current.cycle(); });
    await waitFor(() => expect(result.current.pref).toBe('nocturne'));
    await act(async () => { await result.current.cycle(); });
    await waitFor(() => expect(result.current.pref).toBe('system'));
    await act(async () => { await result.current.cycle(); });
    await waitFor(() => expect(result.current.pref).toBe('giverny'));
    expect(await getTheme()).toBe('giverny');
  });

  test('a change from another page applies via storage events', async () => {
    const { result } = renderHook(() => useTheme());
    await waitFor(() => expect(result.current.pref).toBe('system'));
    await act(async () => {
      (chrome as unknown as ChromeFake).storage.onChanged.dispatch({ theme: { newValue: 'nocturne' } }, 'local');
    });
    await waitFor(() => expect(document.documentElement).toHaveClass('nocturne'));
  });
});
