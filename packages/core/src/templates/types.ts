import type { Element, Relation } from '../schema';

/** A value the user chooses when using a template (Implementation.md §12.1). */
export type TemplateParam =
  | { key: string; label: string; type: 'string'; default: string; help?: string }
  | {
      key: string;
      label: string;
      type: 'number';
      default: number;
      min?: number;
      max?: number;
      help?: string;
    }
  | { key: string; label: string; type: 'enum'; options: string[]; default: string; help?: string }
  | {
      key: string;
      label: string;
      type: 'string[]';
      default: string[];
      /** Most items allowed (keeps the generated diagram readable). */
      max?: number;
      help?: string;
    };

export type ParamValue = string | number | string[];
export type ParamValues = Record<string, ParamValue>;

/** Extra element fields a template may set. */
export type ElementExtra = Partial<
  Pick<
    Element,
    | 'description'
    | 'layer'
    | 'tech'
    | 'responsibilities'
    | 'tags'
    | 'color'
    | 'status'
    | 'owner'
    | 'qualities'
    | 'properties'
    | 'codePaths'
    | 'notes'
  >
>;

export type RelationExtra = Partial<
  Pick<
    Relation,
    | 'label'
    | 'mode'
    | 'protocol'
    | 'via'
    | 'inTransaction'
    | 'contract'
    | 'properties'
    | 'status'
    | 'notes'
  >
>;

export interface ElementSpec extends ElementExtra {
  /** Key of the parent element in this template. */
  parent?: string;
  /** Position relative to the parent (when it has one) or to the drop point. */
  x: number;
  y: number;
}

/** A guided step of the template's tour. Keys refer to template elements. */
export interface TourStepSpec {
  title: string;
  body: string;
  elements?: string[];
  relations?: string[];
  conceptIds?: string[];
}

/** What a template's `build` uses to describe its elements; keys are local to the template. */
export interface TemplateBuilder {
  /** Adds an element and returns its key. */
  el(key: string, kind: string, name: string, spec: ElementSpec): string;
  /** Adds a relation between two keys and returns its key. */
  rel(sourceKey: string, type: string, targetKey: string, extra?: RelationExtra): string;
  /** Adds a step to the template's tour. */
  step(step: TourStepSpec): void;
}

export interface Template {
  /** "rnp.hexagonal-service" */
  id: string;
  /** "T3" */
  code: string;
  /** Semver; recorded in `derivedFrom`. */
  version: string;
  name: string;
  category: 'backend' | 'frontend' | 'fullstack' | 'integration';
  summary: string;
  whenToUse: string[];
  whenNotToUse: string[];
  tradeoffs: string[];
  parameters: TemplateParam[];
  /** Switched on in the project when the template is used. */
  rulePacks: string[];
  /** MUST / MUST NOT sentences with {param} placeholders; exported to agents. */
  invariants: string[];
  /** Element kind → path pattern with {param} placeholders; fills `codePaths`. */
  folderLayout?: Record<string, string>;
  /** Learning text about the pattern (`pattern.*`). */
  learnId?: string;
  build(params: ParamValues, b: TemplateBuilder): void;
}
