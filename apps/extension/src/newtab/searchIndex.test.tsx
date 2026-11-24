import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openDb, type AtelierDB } from '../data/db';
import { installChromeFake } from '../../test/chromeFake';
import { buildIndex } from '../data/search';
import { App } from './App';

vi.mock('../data/search', async (importOriginal) => {
  const real = await importOriginal<typeof import('../data/search')>();
  return { ...real, buildIndex: vi.fn(real.buildIndex) };
});

let db: AtelierDB;
beforeEach(() => {
  installChromeFake();
  db = openDb('test-' + crypto.randomUUID());
  vi.mocked(buildIndex).mockClear();
});

test('the search index is built only while there is a query', async () => {
  const user = userEvent.setup();
  render(<App db={db} />);
  const box = await screen.findByRole('searchbox', { name: 'Search' });
  await screen.findByRole('heading', { level: 2, name: 'Saved' });
  expect(buildIndex).not.toHaveBeenCalled();
  await user.type(box, 'sav');
  await vi.waitFor(() => expect(buildIndex).toHaveBeenCalled());
  await user.clear(box);
  vi.mocked(buildIndex).mockClear();
  await screen.findByRole('heading', { level: 2, name: 'Saved' });
  expect(buildIndex).not.toHaveBeenCalled();
});
