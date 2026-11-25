import { useRef, useState } from 'react';
import { Button } from '../ui/components/Button';
import { Field } from '../ui/components/Field';

/** Single-line name entry: Enter or blur commits once, Escape cancels. */
export function InlineNameField({
  label, initial = '', placeholder, onCommit, onCancel, commitOnBlur = true, submitLabel,
}: {
  label: string; initial?: string; placeholder?: string; onCommit(name: string): void; onCancel(): void;
  /** When false, blur with text does nothing and blur when empty cancels; use with `submitLabel`. */
  commitOnBlur?: boolean; submitLabel?: string;
}) {
  const [value, setValue] = useState(initial);
  const finished = useRef(false);
  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (commit) onCommit(value.trim());
    else onCancel();
  };
  const field = (
    <Field
      label={label}
      hideLabel
      autoFocus
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => { if (commitOnBlur) finish(true); else if (!value.trim()) finish(false); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
    />
  );
  if (!submitLabel) return field;
  return (
    <div className="atl-form">
      {field}
      <div className="atl-form-actions">
        <Button type="button" onClick={() => finish(true)}>{submitLabel}</Button>
      </div>
    </div>
  );
}
