import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> & {
  label: string;
  icon: IconName;
};

export function IconButton({ label, icon, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} title={label} className={['im-btn im-btn-ghost im-icon-btn', className].filter(Boolean).join(' ')} {...rest}>
      <Icon name={icon} />
    </button>
  );
}
