export type DabColor = 'lily' | 'sage' | 'rose' | 'ochre';

export function Dabs({ colors = ['lily', 'sage', 'rose', 'ochre'] }: { colors?: DabColor[] }) {
  return (
    <div className="im-dabs" aria-hidden="true">
      {colors.map((c, i) => (
        <i key={`${c}-${i}`} className={`im-dab im-dab-${c}`} />
      ))}
    </div>
  );
}
