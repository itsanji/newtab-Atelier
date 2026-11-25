import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

type Layout = { places: CSSProperties[]; height: number };
const same = (a: Layout | null, b: Layout) =>
  !!a && a.height === b.height && a.places.length === b.places.length
  && a.places.every((p, i) => p.top === b.places[i]!.top && p.left === b.places[i]!.left && p.width === b.places[i]!.width);

/**
 * Masonry for the list view: as many lanes of `width` as fit the container, and each child, in order, goes
 * into the currently shortest lane. Children keep their place in the DOM (absolute positions), so nothing
 * remounts and drag and drop keeps working. Re-placed when the container's width or any child's height
 * changes. Returns null (plain wrapping) where it can't measure.
 */
export function useMasonry(enabled: boolean, width: number, gap: number, count: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof ResizeObserver === 'undefined') {
      setLayout(null);
      return;
    }
    const place = () => {
      const kids = Array.from(el.children) as HTMLElement[];
      const avail = el.clientWidth;
      const w = Math.min(width, avail);
      const lanes = Math.max(1, Math.floor((avail + gap) / (w + gap)));
      const tops: number[] = new Array(lanes).fill(0);
      const places = kids.map((kid) => {
        const lane = tops.indexOf(Math.min(...tops));
        const at: CSSProperties = { position: 'absolute', top: tops[lane]!, left: lane * (w + gap), width: w };
        tops[lane]! += kid.offsetHeight + gap;
        return at;
      });
      const next = { places, height: Math.max(0, Math.max(...tops) - gap) };
      setLayout((cur) => (same(cur, next) ? cur : next));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    for (const kid of Array.from(el.children)) ro.observe(kid);
    return () => ro.disconnect();
  }, [enabled, width, gap, count]);

  return { ref, places: layout?.places ?? null, height: layout?.height ?? null };
}
