import { useState, type FormEvent } from 'react';
import { Button } from '../ui/components/Button';
import { Field } from '../ui/components/Field';
import { domainOf, normalizeUrl } from './url';

export function LinkForm({
  initial, submitLabel, onSubmit, onCancel,
}: {
  initial?: { url: string; title: string };
  submitLabel: string;
  onSubmit(v: { url: string; title: string }): void | Promise<void>;
  onCancel(): void;
}) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [error, setError] = useState<string>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const normal = normalizeUrl(url);
    if (!normal) {
      setError('Enter a web address, like example.com');
      return;
    }
    void onSubmit({ url: normal, title: title.trim() || domainOf(normal) });
  };

  return (
    <form onSubmit={submit} className="atl-form" noValidate>
      <Field label="Web address" value={url} error={error} autoFocus onChange={(e) => { setUrl(e.target.value); setError(undefined); }} />
      <Field label="Title" hint="Optional" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="atl-form-actions">
        <Button type="submit">{submitLabel}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
