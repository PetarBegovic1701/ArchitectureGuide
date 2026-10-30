import { useEffect, useState } from 'react';
import type { ZodType } from 'zod';
import { fieldsFor } from '../lib/fields';
import type { Field } from '../lib/fields';

interface Props {
  schema: ZodType | undefined;
  value: Record<string, unknown> | undefined;
  /** Called with the full new properties object, or undefined when it becomes empty. */
  onChange: (next: Record<string, unknown> | undefined) => void;
}

/** Form generated from a concept's or relation type's property schema (§13.4). */
export function PropertyForm({ schema, value, onChange }: Props) {
  const fields = fieldsFor(schema);
  if (fields.length === 0) return null;
  const props = value ?? {};
  const set = (key: string, v: unknown) => {
    const next = { ...props };
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete next[key];
    else next[key] = v;
    onChange(Object.keys(next).length ? next : undefined);
  };
  return (
    <div className="space-y-2">
      {fields.map((f) => (
        <FieldInput key={f.key} field={f} value={props[f.key]} onChange={(v) => set(f.key, v)} />
      ))}
    </div>
  );
}

export const inputClass =
  'w-full rounded border border-[var(--ag-border)] bg-[var(--ag-bg)] px-2 py-1 text-sm outline-none focus:border-[var(--ag-accent)]';

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `prop-${field.key}`;
  switch (field.kind) {
    case 'enum':
      return (
        <Row label={field.label} htmlFor={id}>
          <select
            id={id}
            className={inputClass}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value || undefined)}
          >
            <option value="">—</option>
            {field.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Row>
      );
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked ? true : undefined)}
          />
          {field.label}
        </label>
      );
    case 'number':
      return (
        <Row label={field.label} htmlFor={id}>
          <CommitInput
            id={id}
            type="number"
            value={typeof value === 'number' ? String(value) : ''}
            onCommit={(text) => {
              if (text === '') return onChange(undefined);
              const n = field.integer ? Math.round(Number(text)) : Number(text);
              if (!Number.isNaN(n)) onChange(field.min !== undefined ? Math.max(field.min, n) : n);
            }}
          />
        </Row>
      );
    case 'string':
      return (
        <Row label={field.label} htmlFor={id}>
          <CommitInput
            id={id}
            value={typeof value === 'string' ? value : ''}
            onCommit={(t) => onChange(t.trim() || undefined)}
          />
        </Row>
      );
    case 'string-list':
      return (
        <Row label={`${field.label} (comma-separated)`} htmlFor={id}>
          <CommitInput
            id={id}
            value={Array.isArray(value) ? value.join(', ') : ''}
            onCommit={(t) =>
              onChange(
                t
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              )
            }
          />
        </Row>
      );
    case 'enum-list': {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset>
          <legend className="mb-0.5 text-xs text-[var(--ag-muted)]">{field.label}</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {field.options.map((o) => (
              <label key={o} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={list.includes(o)}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))
                  }
                />
                {o}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
    case 'json':
      return (
        <Row label={`${field.label} (JSON)`} htmlFor={id}>
          <CommitInput
            id={id}
            multiline
            value={value === undefined ? '' : JSON.stringify(value, null, 1)}
            onCommit={(t) => {
              if (!t.trim()) return onChange(undefined);
              try {
                onChange(JSON.parse(t));
              } catch {
                // Keep the old value; the model validates the shape on save anyway.
              }
            }}
          />
        </Row>
      );
  }
}

export function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-0.5 block text-xs text-[var(--ag-muted)]">
        {label}
      </label>
      {children}
    </div>
  );
}

/** A text input that saves on blur or Enter, so one edit is one undo step. */
export function CommitInput({
  id,
  value,
  onCommit,
  type = 'text',
  multiline = false,
  placeholder,
  lang,
  dir,
}: {
  id: string;
  value: string;
  onCommit: (text: string) => void;
  type?: string;
  multiline?: boolean;
  placeholder?: string;
  /** Language and direction of the text, for texts written in another language than the UI. */
  lang?: string;
  dir?: 'ltr' | 'rtl' | 'auto';
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text !== value && onCommit(text);
  if (multiline) {
    return (
      <textarea
        id={id}
        className={`${inputClass} min-h-16 font-mono text-xs`}
        value={text}
        placeholder={placeholder}
        lang={lang}
        dir={dir}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
      />
    );
  }
  return (
    <input
      id={id}
      type={type}
      className={inputClass}
      value={text}
      placeholder={placeholder}
      lang={lang}
      dir={dir}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}
