import { describe, expect, test } from 'bun:test';
import { renderNotFoundPage, renderSharePage } from '../../src/share/page';
import { magicConfirmPage, magicDonePage, magicInvalidPage } from '../../src/auth/pages';

const LONG = 'x'.repeat(400);
const styleOf = (html: string) => html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

describe('server HTML pages wrap long unbroken text', () => {
  test('the share page wraps long titles, urls and notes, and fits a phone', () => {
    const html = renderSharePage({ name: LONG, emoji: null }, [
      { kind: 'link', title: LONG, url: `https://example.com/${LONG}`, note: LONG, body: null, done: false },
      { kind: 'todo', title: LONG, url: null, note: null, body: null, done: false },
    ]);
    expect(html).toContain('name="viewport" content="width=device-width,initial-scale=1"');
    expect(styleOf(html)).toMatch(/body\{[^}]*overflow-wrap:anywhere/);
    expect(html).toContain(LONG);
  });

  test('the not-found and sign-in pages wrap too', () => {
    for (const html of [renderNotFoundPage(), magicConfirmPage(LONG), magicDonePage(), magicInvalidPage()]) {
      expect(styleOf(html)).toMatch(/body\{[^}]*overflow-wrap:anywhere/);
    }
  });
});
