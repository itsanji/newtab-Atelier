import { useRef, useState } from 'react';
import { Field } from '../ui/components/Field';

/** Single-line name entry: Enter or blur commits once, Escape cancels. */
export function InlineNameField({
  label, initial = '', placeholder, onCommit, onCancel,
}: { label: string; initial?: string; placeholder?: string; onCommit(name: string): void; onCancel(): void }) {
  const [value, setValue] = useState(initial);
  const finished = useRef(false);
  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (commit) onCommit(value.trim());
    else onCancel();
  };
  return (
    <Field
      label={label}
      hideLabel
      autoFocus
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
    />
  );
}
