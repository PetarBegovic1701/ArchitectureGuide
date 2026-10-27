import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Trash2, Upload, X } from 'lucide-react';
import {
  RULE_PACKS,
  parseTemplateFile,
  renderInvariants,
  resolveParams,
  slugify,
  templateFromFile,
  templateFromSelection,
  uniqueId,
} from '@archguide/core';
import type { Template, TemplateFile, TemplateParam } from '@archguide/core';
import { docs } from '../lib/catalog';
import { activeView } from '../lib/model';
import { BUILTIN_TEMPLATES } from '../lib/templates';
import { exportTemplateFile } from '../actions';
import { deleteTemplate, listTemplates, saveTemplate } from '../persistence/db';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';

const field =
  'w-full rounded border border-[var(--ag-border)] bg-[var(--ag-bg)] px-2 py-1 text-sm outline-none focus:border-[var(--ag-accent)]';

/** Raw form value of a parameter: lists are edited as comma-separated text. */
const rawDefault = (p: TemplateParam): string =>
  p.type === 'string[]' ? p.default.join(', ') : String(p.default);

interface Entry {
  template: Template;
  file?: TemplateFile;
}

/**
 * Template gallery with a parameter form (§12.1). In "project" mode it also asks for a
 * project name; in "stamp" mode it adds the template to the open canvas.
 */
export function TemplatePicker({
  mode,
  onClose,
  onUse,
}: {
  mode: 'project' | 'stamp';
  onClose: () => void;
  onUse: (template: Template, params: Record<string, unknown>, projectName: string) => void;
}) {
  const [custom, setCustom] = useState<TemplateFile[]>([]);
  const [selectedId, setSelectedId] = useState(BUILTIN_TEMPLATES[0]?.id ?? '');
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [projectName, setProjectName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useUi((s) => s.toast);

  const refresh = () => void listTemplates().then(setCustom);
  useEffect(refresh, []);

  const entries = useMemo<Entry[]>(
    () => [
      ...BUILTIN_TEMPLATES.map((template) => ({ template })),
      ...custom.map((file) => ({ template: templateFromFile(file), file })),
    ],
    [custom],
  );
  const entry = entries.find((e) => e.template.id === selectedId) ?? entries[0];
  const template = entry?.template;

  useEffect(() => {
    if (!template) return;
    setRaw(Object.fromEntries(template.parameters.map((p) => [p.key, rawDefault(p)])));
    setProjectName(template.code === 'Custom' ? template.name : template.name.split(':')[0]!);
  }, [template]);

  if (!template) return null;
  const { values, errors } = resolveParams(template, raw);
  const nameMissing = mode === 'project' && !projectName.trim();
  const doc = template.learnId ? docs.get(template.learnId) : undefined;

  const importFile = async (file: File) => {
    try {
      const parsed = parseTemplateFile(await file.text());
      await saveTemplate(parsed);
      refresh();
      setSelectedId(`custom.${parsed.id}`);
      toast({ tone: 'success', message: `Imported template “${parsed.name}”.` });
    } catch (error) {
      toast({ tone: 'error', message: (error as Error).message });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'project' ? 'New project from a template' : 'Insert a template'}
        className="flex h-[min(640px,90vh)] w-[min(960px,96vw)] overflow-hidden rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] shadow-2xl"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <nav
          className="flex w-64 shrink-0 flex-col border-r border-[var(--ag-border)]"
          aria-label="Templates"
        >
          <ul className="flex-1 overflow-y-auto p-2" role="listbox" aria-label="Template list">
            {entries.map(({ template: t, file }, i) => (
              <li key={t.id}>
                {file && !entries[i - 1]?.file && (
                  <h3 className="mb-1 mt-3 px-2 text-xs font-semibold uppercase tracking-wide text-[var(--ag-muted)]">
                    Saved from selections
                  </h3>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={t.id === template.id}
                  className={`w-full rounded px-2 py-1.5 text-left text-sm ${t.id === template.id ? 'bg-[var(--ag-panel-2)] font-semibold' : 'hover:bg-[var(--ag-panel-2)]'}`}
                  onClick={() => setSelectedId(t.id)}
                  data-testid={`template-${t.id}`}
                >
                  <span className="mr-1 text-xs text-[var(--ag-muted)]">{t.code}</span>
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="flex items-center gap-1 border-t border-[var(--ag-border)] px-3 py-2 text-left text-sm text-[var(--ag-accent)]"
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={14} aria-hidden /> Import template file…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-label="Import template file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = '';
            }}
          />
        </nav>

        <form
          className="flex min-w-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (Object.keys(errors).length === 0 && !nameMissing)
              onUse(template, values, projectName.trim());
          }}
        >
          <header className="flex items-start gap-2 border-b border-[var(--ag-border)] p-4">
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">
                <span className="mr-1 text-[var(--ag-muted)]">{template.code}</span>
                {template.name}
              </h2>
              <p className="text-sm text-[var(--ag-muted)]">{template.summary}</p>
            </div>
            {entry.file && (
              <>
                <button
                  type="button"
                  className="rounded p-1 hover:bg-[var(--ag-panel-2)]"
                  aria-label="Export template file"
                  title="Export template file"
                  onClick={() => exportTemplateFile(entry.file!)}
                >
                  <Download size={16} />
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-[var(--ag-error)] hover:bg-[var(--ag-panel-2)]"
                  aria-label="Delete template"
                  title="Delete template"
                  onClick={async () => {
                    if (!window.confirm(`Delete the template “${template.name}”?`)) return;
                    await deleteTemplate(entry.file!.id);
                    setSelectedId(BUILTIN_TEMPLATES[0]?.id ?? '');
                    refresh();
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
            <button
              type="button"
              className="rounded p-1 hover:bg-[var(--ag-panel-2)]"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </header>

          <div className="grid flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-2">
            <div className="space-y-3 text-sm">
              <Bullets title="When to use" items={template.whenToUse} />
              <Bullets title="When not to use" items={template.whenNotToUse} />
              <Bullets title="Trade-offs" items={template.tradeoffs} />
              {template.invariants.length > 0 && (
                <Bullets
                  title="Rules it sets (for people and agents)"
                  items={renderInvariants(template, values)}
                />
              )}
              {template.rulePacks.length > 0 && (
                <p className="text-xs text-[var(--ag-muted)]">
                  Turns on the rule packs:{' '}
                  {template.rulePacks
                    .map((id) => RULE_PACKS.find((p) => p.id === id)?.name ?? id)
                    .join(', ')}
                  .
                </p>
              )}
              {doc && (
                <p className="text-xs">
                  <span className="font-semibold">Learn more:</span> {doc.title}. {doc.summary}
                </p>
              )}
            </div>

            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-semibold">Settings</legend>
              {mode === 'project' && (
                <label className="block text-sm">
                  <span className="mb-1 block text-xs text-[var(--ag-muted)]">Project name</span>
                  <input
                    className={field}
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    aria-invalid={nameMissing}
                  />
                </label>
              )}
              {template.parameters.map((p) => (
                <ParamField
                  key={p.key}
                  param={p}
                  value={raw[p.key] ?? ''}
                  error={errors[p.key]}
                  onChange={(v) => setRaw((r) => ({ ...r, [p.key]: v }))}
                />
              ))}
              {template.parameters.length === 0 && mode === 'stamp' && (
                <p className="text-sm text-[var(--ag-muted)]">This template has no settings.</p>
              )}
            </fieldset>
          </div>

          <footer className="flex justify-end gap-2 border-t border-[var(--ag-border)] p-3">
            <button type="button" className="rounded px-3 py-1.5 text-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={Object.keys(errors).length > 0 || nameMissing}
              className="rounded bg-[var(--ag-accent)] px-3 py-1.5 text-sm font-semibold text-[var(--ag-accent-text)] disabled:opacity-40"
            >
              {mode === 'project' ? 'Create project' : 'Insert'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function Bullets({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ag-muted)]">
        {title}
      </h3>
      <ul className="ml-4 list-disc">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function ParamField({
  param: p,
  value,
  error,
  onChange,
}: {
  param: TemplateParam;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const id = `param-${p.key}`;
  return (
    <div className="text-sm">
      <label htmlFor={id} className="mb-1 block text-xs text-[var(--ag-muted)]">
        {p.label}
        {p.type === 'string[]' && ' (comma-separated)'}
      </label>
      {p.type === 'enum' ? (
        <select id={id} className={field} value={value} onChange={(e) => onChange(e.target.value)}>
          {p.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className={field}
          type={p.type === 'number' ? 'number' : 'text'}
          value={value}
          aria-invalid={!!error}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {p.help && <p className="mt-0.5 text-xs text-[var(--ag-muted)]">{p.help}</p>}
      {error && <p className="mt-0.5 text-xs text-[var(--ag-error)]">{error}</p>}
    </div>
  );
}

/** Saves the selected elements (and everything inside them) as a reusable template. */
export function SaveTemplateDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const toast = useUi((s) => s.toast);
  const valid = name.trim().length > 0 && slugify(name).length > 0;

  const save = async () => {
    const { project, viewId, selection } = useProject.getState();
    if (!project) return;
    try {
      const taken = new Set((await listTemplates()).map((t) => t.id));
      const file = templateFromSelection(project, activeView(project, viewId), selection.elements, {
        id: uniqueId(slugify(name), taken),
        name: name.trim(),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
        createdAt: new Date().toISOString(),
      });
      await saveTemplate(file);
      toast({
        tone: 'success',
        message: `Saved the template “${file.name}” (${file.elements.length} elements).`,
        actions: [{ label: 'Export file', run: () => exportTemplateFile(file) }],
      });
      onClose();
    } catch (error) {
      toast({ tone: 'error', message: (error as Error).message });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Save selection as template"
        className="w-[26rem] space-y-3 rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] p-4 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void save();
        }}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 className="font-semibold">Save selection as template</h2>
        <p className="text-sm text-[var(--ag-muted)]">
          The selected elements, everything inside them, and the relations between them. Use it
          later from Templates, or export it as a file to share.
        </p>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-[var(--ag-muted)]">Name</span>
          <input
            autoFocus
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-[var(--ag-muted)]">Summary (optional)</span>
          <input className={field} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={!valid}
            className="rounded bg-[var(--ag-accent)] px-3 py-1 text-sm text-[var(--ag-accent-text)] disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
