import { useEffect, useRef, useState } from 'react';
import { CATEGORY_WIDTH, MIN_CATEGORY_WIDTH, type CategorySize } from '../data/boardView';
import { Icon } from '../ui/components/Icon';
import { useFitInView } from '../ui/components/useFitInView';

const NAMES: Record<Exclude<CategorySize, 'custom'>, string> = { s: 'Small', m: 'Medium', l: 'Large' };

/** The widest a category can be: the board's own width (or the window's, before the board is there). */
function boardWidth(): number {
  const board = document.querySelector<HTMLElement>('.atl-board');
  const w = board?.clientWidth || window.innerWidth;
  return Math.max(MIN_CATEGORY_WIDTH, Math.floor(w));
}

/**
 * S / M / L presets plus a gear for a custom width. The gear opens a slider below the switch, from S to
 * the board's width; it closes on Escape, a click elsewhere, or picking a preset.
 */
export function SizeSwitch({ size, onSizeChange, customWidth, onCustomWidthChange }: {
  size: CategorySize; onSizeChange(size: CategorySize): void;
  customWidth: number; onCustomWidthChange(px: number): void;
}) {
  const [open, setOpen] = useState(false);
  const [max, setMax] = useState(boardWidth);
  const box = useRef<HTMLDivElement | null>(null);
  const pop = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState(0);
  useFitInView(pop, open, viewport);

  useEffect(() => {
    if (!open) return;
    setMax(boardWidth());
    const onResize = () => { setMax(boardWidth()); setViewport(window.innerWidth); };
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('resize', onResize);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = Math.min(customWidth, max);
  return (
    <div className="atl-size-wrap" ref={box}>
      <div className="atl-size" role="group" aria-label="Category size">
        {(['s', 'm', 'l'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className="atl-size-btn"
            aria-pressed={size === s}
            aria-label={NAMES[s]}
            title={`Category size: ${NAMES[s]} (${CATEGORY_WIDTH[s]}px)`}
            onClick={() => { onSizeChange(s); setOpen(false); }}
          >
            {s.toUpperCase()}
          </button>
        ))}
        <button
          type="button"
          className="atl-size-btn"
          aria-pressed={size === 'custom'}
          aria-expanded={open}
          aria-label="Custom"
          title={size === 'custom' ? `Category size: custom (${shown}px)` : 'Category size: custom'}
          onClick={() => { onSizeChange('custom'); setOpen((o) => !o); }}
        >
          <Icon name="gear" size={16} />
        </button>
      </div>
      {open && (
        <div className="atl-size-pop" ref={pop}>
          <input
            type="range"
            aria-label="Category width"
            min={MIN_CATEGORY_WIDTH}
            max={max}
            step={10}
            value={shown}
            onChange={(e) => onCustomWidthChange(Number(e.target.value))}
          />
          <output className="atl-size-value">{shown}px</output>
        </div>
      )}
    </div>
  );
}
