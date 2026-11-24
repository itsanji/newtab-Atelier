import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../ui/components/Icon';

const COLS = 8;

export const EMOJI: ReadonlyArray<readonly [string, string]> = [
  ['📚', 'books'], ['📁', 'folder'], ['⭐', 'star'], ['🌱', 'plant'], ['🏠', 'house'], ['✈️', 'plane'], ['💼', 'briefcase'], ['🎵', 'music'],
  ['📷', 'camera'], ['☕', 'coffee'], ['💡', 'light bulb'], ['🔖', 'bookmark'], ['📝', 'memo'], ['📅', 'calendar'], ['🎨', 'palette'], ['🧪', 'flask'],
  ['🔧', 'wrench'], ['💻', 'laptop'], ['📱', 'phone'], ['🎮', 'game'], ['🎬', 'film'], ['🍳', 'cooking'], ['🍎', 'apple'], ['🛒', 'cart'],
  ['💰', 'money'], ['📈', 'chart'], ['🎓', 'graduation'], ['🔬', 'microscope'], ['🧭', 'compass'], ['🗺️', 'map'], ['🚗', 'car'], ['🚲', 'bicycle'],
  ['⛰️', 'mountain'], ['🌊', 'wave'], ['🌸', 'blossom'], ['🌳', 'tree'], ['🌙', 'moon'], ['☀️', 'sun'], ['🔥', 'fire'], ['💧', 'drop'],
  ['🐾', 'paw prints'], ['🐟', 'fish'], ['🦋', 'butterfly'], ['🐝', 'bee'], ['🎁', 'gift'], ['🎈', 'balloon'], ['🏆', 'trophy'], ['🎯', 'target'],
  ['🧩', 'puzzle'], ['🔑', 'key'], ['🔒', 'lock'], ['📦', 'package'], ['✏️', 'pencil'], ['🖌️', 'brush'], ['📰', 'newspaper'], ['🎧', 'headphones'],
  ['🏋️', 'weights'], ['🧘', 'meditation'], ['🍷', 'wine'], ['🍕', 'pizza'], ['🏖️', 'beach'], ['⚽', 'football'], ['🎸', 'guitar'], ['🧵', 'thread'],
];

export function EmojiPicker({ value, onChange }: { value: string | null | undefined; onChange(emoji: string | null): void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const id = useId();

  const cells = () => Array.from(grid.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);

  const close = () => { setOpen(false); trigger.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    cells()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    const els = cells();
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key];
    let next: number | undefined;
    if (step !== undefined) next = i + step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = els.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    if (next >= 0 && next < els.length) els[next]?.focus();
  };

  const pick = (emoji: string | null) => { onChange(emoji); close(); };

  return (
    <div className="atl-emoji" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="atl-icon atl-emoji-btn"
        aria-label={value ? 'Change emoji' : 'Add emoji'}
        title={value ? 'Change emoji' : 'Add emoji'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {value ? <span aria-hidden="true">{value}</span> : <Icon name="plus" size={18} />}
      </button>
      {open && (
        <div id={id} role="dialog" aria-label="Choose emoji" className="atl-emoji-pop" onKeyDown={onKey}>
          <div ref={grid} className="atl-emoji-grid">
            {EMOJI.map(([emoji, name]) => (
              <button key={name} type="button" className="atl-emoji-cell" aria-label={name} onClick={() => pick(emoji)} tabIndex={-1}>
                <span aria-hidden="true">{emoji}</span>
              </button>
            ))}
          </div>
          {value && <button type="button" className="atl-textlink atl-emoji-remove" onClick={() => pick(null)}>Remove</button>}
        </div>
      )}
    </div>
  );
}
