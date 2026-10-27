import { parse as parseYaml } from 'yaml';
import { LearningDocSchema, LessonSchema } from './schema';
import type { CodeExample, LearningDoc, Lesson } from './schema';

export class ContentError extends Error {}

type Section =
  | { field: 'beginner' | 'intermediate' | 'senior' | 'analogy'; kind: 'text' }
  | { field: 'whenToUse' | 'whenNotToUse' | 'tradeoffs' | 'mistakes'; kind: 'list' }
  | { field: 'examples'; kind: 'examples' };

/** `## Heading` → field. Headings are matched without case. */
const SECTIONS: Record<string, Section> = {
  beginner: { field: 'beginner', kind: 'text' },
  intermediate: { field: 'intermediate', kind: 'text' },
  senior: { field: 'senior', kind: 'text' },
  analogy: { field: 'analogy', kind: 'text' },
  'when to use': { field: 'whenToUse', kind: 'list' },
  'when not to use': { field: 'whenNotToUse', kind: 'list' },
  'trade-offs': { field: 'tradeoffs', kind: 'list' },
  'common mistakes': { field: 'mistakes', kind: 'list' },
  examples: { field: 'examples', kind: 'examples' },
};

/**
 * Parses a learning text (Implementation.md §17.4):
 * YAML front matter (id, kind, title, summary, level, tracks, related, references, quiz ...)
 * followed by `## Beginner`, `## Senior` ... sections.
 */
export function parseLearningDoc(text: string, source = '<doc>'): LearningDoc {
  const normalized = text.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!match) throw new ContentError(`${source}: missing YAML front matter between "---" lines`);
  const meta = parseYamlObject(match[1]!, source);
  const body = match[2]!;

  const explain: Record<string, string> = {};
  const fields: Record<string, unknown> = {};
  const parts = body.split(/^## +/m);
  if (parts[0]!.trim() !== '') {
    throw new ContentError(`${source}: text before the first "## " section`);
  }
  for (const part of parts.slice(1)) {
    const newline = part.indexOf('\n');
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
    const content = newline === -1 ? '' : part.slice(newline + 1).trim();
    const section = SECTIONS[heading.toLowerCase()];
    if (!section) {
      throw new ContentError(
        `${source}: unknown section "## ${heading}". Known: ${Object.keys(SECTIONS).join(', ')}`,
      );
    }
    if (content === '') throw new ContentError(`${source}: section "## ${heading}" is empty`);
    if (section.kind === 'text') {
      if (section.field === 'analogy') fields.analogy = content;
      else explain[section.field] = content;
    } else if (section.kind === 'list') {
      fields[section.field] = parseList(content, source, heading);
    } else {
      fields.examples = parseExamples(content, source);
    }
  }

  const result = LearningDocSchema.safeParse({ ...meta, ...fields, explain, source });
  if (!result.success) throw new ContentError(`${source}: ${formatIssues(result.error.issues)}`);
  return result.data;
}

/** Parses a lesson written in YAML (Implementation.md §17.5). */
export function parseLesson(text: string, source = '<lesson>'): Lesson {
  const raw = parseYamlObject(text, source);
  const result = LessonSchema.safeParse({ ...raw, source });
  if (!result.success) throw new ContentError(`${source}: ${formatIssues(result.error.issues)}`);
  return result.data;
}

function parseYamlObject(text: string, source: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = parseYaml(text);
  } catch (e) {
    throw new ContentError(`${source}: invalid YAML: ${(e as Error).message}`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContentError(`${source}: YAML must be a mapping`);
  }
  return value as Record<string, unknown>;
}

/** "- item" lines; indented lines continue the previous item. */
function parseList(content: string, source: string, heading: string): string[] {
  const items: string[] = [];
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue;
    if (line.startsWith('- ')) items.push(line.slice(2).trim());
    else if (/^\s+\S/.test(line) && items.length > 0) items[items.length - 1] += ` ${line.trim()}`;
    else throw new ContentError(`${source}: "## ${heading}" must be a "- " list, got: ${line}`);
  }
  return items;
}

/** Fenced code blocks. The last text line before a block (without ** and ":") is its title. */
function parseExamples(content: string, source: string): CodeExample[] {
  const examples: CodeExample[] = [];
  const fence = /^```([\w+#-]*)\n([\s\S]*?)\n```$/gm;
  let last = 0;
  for (let m = fence.exec(content); m; m = fence.exec(content)) {
    const language = m[1]!;
    if (!language) throw new ContentError(`${source}: every example needs a language after \`\`\``);
    const before = content.slice(last, m.index).trim().split('\n').filter(Boolean).pop();
    const title = before?.replace(/\*\*/g, '').replace(/:$/, '').trim();
    examples.push({ ...(title ? { title } : {}), language, code: m[2]! });
    last = m.index + m[0].length;
  }
  if (examples.length === 0) throw new ContentError(`${source}: "## Examples" has no code block`);
  return examples;
}

function formatIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 5)
    .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join('; ');
}
