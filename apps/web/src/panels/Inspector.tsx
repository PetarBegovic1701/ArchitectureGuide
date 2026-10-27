import { IdSchema, validRelationTypes } from '@archguide/core';
import type { Element, Layer, Relation, Status } from '@archguide/core';
import { catalog, conceptOf } from '../lib/catalog';
import { LAYERS, elementById, takenIds } from '../lib/model';
import { dispatch } from '../actions';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { LearnPanel } from './LearnPanel';
import { CommitInput, PropertyForm, Row, inputClass } from './PropertyForm';

const STATUSES: Status[] = ['planned', 'existing', 'deprecated'];

/** Right panel: properties of the selection, and the Learn tab (§13.4, §17.7). */
export function Inspector() {
  const tab = useUi((s) => s.inspectorTab);
  const setTab = useUi((s) => s.setInspectorTab);
  return (
    <aside
      className="flex h-full w-80 shrink-0 flex-col border-l border-[var(--ag-border)] bg-[var(--ag-panel)]"
      aria-label="Inspector"
    >
      <div className="flex border-b border-[var(--ag-border)] text-sm" role="tablist">
        {(['properties', 'learn'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 capitalize ${tab === t ? 'border-b-2 border-[var(--ag-accent)] font-semibold' : 'text-[var(--ag-muted)]'}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3" role="tabpanel">
        {tab === 'properties' ? <PropertiesTab /> : <LearnPanel />}
      </div>
    </aside>
  );
}

function PropertiesTab() {
  const project = useProject((s) => s.project);
  const selection = useProject((s) => s.selection);
  if (!project) return null;
  const count = selection.elements.length + selection.relations.length;
  if (count === 0) {
    return (
      <div className="space-y-2 text-sm text-[var(--ag-muted)]">
        <p>Nothing selected.</p>
        <p>
          Drag a shape from the palette, or click it to add it. Drag from the dot on a shape's
          border to another shape to connect them.
        </p>
      </div>
    );
  }
  if (count > 1) return <p className="text-sm text-[var(--ag-muted)]">{count} items selected.</p>;
  const element = selection.elements[0] ? elementById(project, selection.elements[0]) : undefined;
  if (element) return <ElementForm key={element.id} element={element} />;
  const relation = project.model.relations.find((r) => r.id === selection.relations[0]);
  return relation ? <RelationForm key={relation.id} relation={relation} /> : null;
}

function patchElement(id: string, patch: Record<string, unknown>, label = 'Edit') {
  dispatch([{ op: 'updateElement', id, patch }], { label });
}

function lines(text: string): string[] | null {
  const list = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

function ElementForm({ element: el }: { element: Element }) {
  const concept = conceptOf(el.kind);
  const learn = () => useUi.getState().openLearn({ kind: 'doc', id: el.kind });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => e.preventDefault()}
      aria-label="Element properties"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-[var(--ag-muted)]">
            {concept?.name ?? el.kind}
          </div>
          <button
            type="button"
            className="text-xs text-[var(--ag-accent)] hover:underline"
            onClick={learn}
          >
            What is this?
          </button>
        </div>
      </div>
      <Row label="Name" htmlFor="el-name">
        <CommitInput
          id="el-name"
          value={el.name}
          onCommit={(t) => t.trim() && patchElement(el.id, { name: t.trim() }, 'Rename')}
        />
      </Row>
      <Row label="ID" htmlFor="el-id">
        <CommitInput
          id="el-id"
          value={el.id}
          onCommit={(t) => {
            const to = t.trim();
            const p = useProject.getState().project;
            if (!p || to === el.id) return;
            if (!IdSchema.safeParse(to).success) {
              useUi.getState().toast({
                tone: 'error',
                message: `"${to}" is not a valid ID: use lowercase letters, digits, "." and "-".`,
              });
              return;
            }
            if (takenIds(p).has(to)) {
              useUi.getState().toast({ tone: 'error', message: `The ID "${to}" is already used.` });
              return;
            }
            if (dispatch([{ op: 'renameId', from: el.id, to }], { label: 'Rename ID' })) {
              useProject.getState().select({ elements: [to], relations: [] });
            }
          }}
        />
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Row label="Layer" htmlFor="el-layer">
          <select
            id="el-layer"
            className={inputClass}
            value={el.layer ?? ''}
            onChange={(e) => patchElement(el.id, { layer: (e.target.value as Layer) || null })}
          >
            <option value="">default</option>
            {LAYERS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Status" htmlFor="el-status">
          <select
            id="el-status"
            className={inputClass}
            value={el.status}
            onChange={(e) => patchElement(el.id, { status: e.target.value })}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Row>
      </div>
      <Row label="Technology" htmlFor="el-tech">
        <CommitInput
          id="el-tech"
          value={el.tech ?? ''}
          placeholder="e.g. NestJS 11"
          onCommit={(t) => patchElement(el.id, { tech: t.trim() || null })}
        />
      </Row>
      <Row label="Description" htmlFor="el-description">
        <CommitInput
          id="el-description"
          multiline
          value={el.description ?? ''}
          onCommit={(t) => patchElement(el.id, { description: t.trim() || null })}
        />
      </Row>
      <Row label="Responsibilities (one per line)" htmlFor="el-resp">
        <CommitInput
          id="el-resp"
          multiline
          value={(el.responsibilities ?? []).join('\n')}
          onCommit={(t) => patchElement(el.id, { responsibilities: lines(t) })}
        />
      </Row>
      {concept?.propertySchema && (
        <fieldset className="space-y-2 rounded border border-[var(--ag-border)] p-2">
          <legend className="px-1 text-xs font-semibold">{concept.name} settings</legend>
          <PropertyForm
            schema={concept.propertySchema}
            value={el.properties}
            onChange={(next) => patchElement(el.id, { properties: next ?? null })}
          />
        </fieldset>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Row label="Owner (team)" htmlFor="el-owner">
          <CommitInput
            id="el-owner"
            value={el.owner ?? ''}
            onCommit={(t) => patchElement(el.id, { owner: t.trim() || null })}
          />
        </Row>
        <Row label="Color" htmlFor="el-color">
          <div className="flex gap-1">
            <input
              id="el-color"
              type="color"
              className="h-7 w-10 rounded border border-[var(--ag-border)]"
              value={el.color?.startsWith('#') ? el.color : '#3b82f6'}
              onChange={(e) => patchElement(el.id, { color: e.target.value }, 'Color')}
            />
            {el.color && (
              <button
                type="button"
                className="text-xs text-[var(--ag-accent)]"
                onClick={() => patchElement(el.id, { color: null }, 'Color')}
              >
                Reset
              </button>
            )}
          </div>
        </Row>
      </div>
      <Row label="Tags (comma-separated)" htmlFor="el-tags">
        <CommitInput
          id="el-tags"
          value={(el.tags ?? []).join(', ')}
          onCommit={(t) => {
            const tags = t
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean);
            patchElement(el.id, { tags: tags.length ? tags : null });
          }}
        />
      </Row>
      <Row label="Code paths (one glob per line)" htmlFor="el-code">
        <CommitInput
          id="el-code"
          multiline
          value={(el.codePaths ?? []).join('\n')}
          placeholder="services/orders/src/**"
          onCommit={(t) => patchElement(el.id, { codePaths: lines(t) })}
        />
      </Row>
      <Row label="Notes (Markdown)" htmlFor="el-notes">
        <CommitInput
          id="el-notes"
          multiline
          value={el.notes ?? ''}
          onCommit={(t) => patchElement(el.id, { notes: t.trim() || null })}
        />
      </Row>
    </form>
  );
}

function RelationForm({ relation: r }: { relation: Relation }) {
  const project = useProject((s) => s.project)!;
  const source = elementById(project, r.sourceId);
  const target = elementById(project, r.targetId);
  const type = catalog.relationTypes.get(r.type);
  const valid = source && target ? validRelationTypes(catalog, source.kind, target.kind) : [];
  const patch = (p: Record<string, unknown>, label = 'Edit relation') =>
    dispatch([{ op: 'updateRelation', id: r.id, patch: p }], { label });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => e.preventDefault()}
      aria-label="Relation properties"
    >
      <div>
        <div className="text-xs uppercase tracking-wide text-[var(--ag-muted)]">Relation</div>
        <p className="text-sm">
          <strong>{source?.name}</strong> {type?.name ?? r.type} <strong>{target?.name}</strong>
        </p>
        <button
          type="button"
          className="text-xs text-[var(--ag-accent)] hover:underline"
          onClick={() => useUi.getState().openLearn({ kind: 'doc', id: r.type })}
        >
          What does “{type?.name ?? r.type}” mean?
        </button>
      </div>
      <Row label="Type" htmlFor="rel-type">
        <select
          id="rel-type"
          className={inputClass}
          value={r.type}
          onChange={(e) => patch({ type: e.target.value, properties: null }, 'Change type')}
        >
          {valid.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Label" htmlFor="rel-label">
        <CommitInput
          id="rel-label"
          value={r.label ?? ''}
          placeholder="e.g. POST /orders"
          onCommit={(t) => patch({ label: t.trim() || null })}
        />
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Row label="Protocol" htmlFor="rel-protocol">
          <CommitInput
            id="rel-protocol"
            value={r.protocol ?? ''}
            placeholder="http"
            onCommit={(t) => patch({ protocol: t.trim() || null })}
          />
        </Row>
        <Row label="Via (library)" htmlFor="rel-via">
          <CommitInput
            id="rel-via"
            value={r.via ?? ''}
            placeholder="prisma"
            onCommit={(t) => patch({ via: t.trim() || null })}
          />
        </Row>
      </div>
      {(r.type === 'enqueues' || r.type === 'publishes') && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={r.inTransaction === true}
            onChange={(e) => patch({ inTransaction: e.target.checked || null })}
          />
          In the same transaction as the data
        </label>
      )}
      <Row label="Status" htmlFor="rel-status">
        <select
          id="rel-status"
          className={inputClass}
          value={r.status}
          onChange={(e) => patch({ status: e.target.value })}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Row>
      {type?.propertySchema && (
        <fieldset className="space-y-2 rounded border border-[var(--ag-border)] p-2">
          <legend className="px-1 text-xs font-semibold">{type.name} settings</legend>
          <PropertyForm
            schema={type.propertySchema}
            value={r.properties}
            onChange={(next) => patch({ properties: next ?? null })}
          />
        </fieldset>
      )}
      <Row label="Notes (Markdown)" htmlFor="rel-notes">
        <CommitInput
          id="rel-notes"
          multiline
          value={r.notes ?? ''}
          onCommit={(t) => patch({ notes: t.trim() || null })}
        />
      </Row>
    </form>
  );
}
