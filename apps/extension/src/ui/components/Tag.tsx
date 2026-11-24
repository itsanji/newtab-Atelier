import type { ReactNode } from 'react';

export function Tag({ tone = 'neutral', children }: { tone?: 'neutral' | 'lily' | 'sage' | 'rose' | 'ochre'; children: ReactNode }) {
  const cls = ['im-tag', tone !== 'neutral' && `im-tag-${tone}`].filter(Boolean).join(' ');
  return <span className={cls}>{children}</span>;
}
