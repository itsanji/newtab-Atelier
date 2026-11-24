import type { SearchHit } from '../data/search';
import { faviconUrl } from '../chrome/favicon';
import { useState } from 'react';

const TONES = ['lily', 'sage', 'rose', 'ochre'] as const;
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function Tile({ hit, url }: { hit: SearchHit; url?: string }) {
  const [broken, setBroken] = useState(false);
  const label = hit.title || (hit.kind === 'note' ? 'Untitled note' : '');
  return (
    <span className={`atl-fav atl-tone-${TONES[hash(hit.itemId) % 4]}`} aria-hidden="true">
      {hit.kind === 'link' && url && !broken ? (
        <img src={faviconUrl(url)} alt="" width={20} height={20} onError={() => setBroken(true)} />
      ) : (
        label.charAt(0).toUpperCase()
      )}
    </span>
  );
}

export function SearchResults({
  query, hits, urls, onPick,
}: { query: string; hits: SearchHit[]; urls: Map<string, string>; onPick(hit: SearchHit): void }) {
  return (
    <section className="atl-results" aria-label="Search results">
      <p className="im-eyebrow" role="status">{hits.length === 1 ? '1 result' : `${hits.length} results`}</p>
      {hits.length === 0 ? (
        <p className="atl-results-empty">Nothing matches “{query}”</p>
      ) : (
        <ul className="atl-results-list">
          {hits.map((hit) => (
            <li key={hit.itemId}>
              <button type="button" className="atl-link atl-result" onClick={() => onPick(hit)}>
                <Tile hit={hit} url={urls.get(hit.itemId)} />
                <span className="atl-item-text">
                  <span className="atl-item-title">{hit.title || (hit.kind === 'note' ? 'Untitled note' : 'Untitled')}</span>
                  <span className="atl-item-domain">{hit.workspaceName} · {hit.categoryName}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
