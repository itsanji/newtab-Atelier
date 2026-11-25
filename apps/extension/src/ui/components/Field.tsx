import { useId, type InputHTMLAttributes } from 'react';

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
};

export function Field({ label, hint, error, hideLabel, id, className, ...rest }: FieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const noteId = `${inputId}-note`;
  const note = error ?? hint;
  return (
    <div className={['im-field', error && 'im-field-error', className].filter(Boolean).join(' ')}>
      <label htmlFor={inputId} className={hideLabel ? 'im-visually-hidden' : 'im-field-label'}>
        {label}
      </label>
      <input
        id={inputId}
        className="im-field-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        {...rest}
      />
      {note && (
        <span id={noteId} className="im-field-hint">
          {note}
        </span>
      )}
    </div>
  );
}
