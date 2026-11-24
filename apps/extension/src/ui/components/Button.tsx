import type { ButtonHTMLAttributes } from 'react';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'quiet' | 'ghost' | 'danger';
};

export function Button({ variant = 'quiet', className, type = 'button', ...rest }: ButtonProps) {
  const cls = ['im-btn', variant !== 'quiet' && `im-btn-${variant}`, className].filter(Boolean).join(' ');
  return <button type={type} className={cls} {...rest} />;
}
