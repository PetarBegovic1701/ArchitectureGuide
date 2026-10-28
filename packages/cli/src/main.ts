import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Command, CommanderError, Option } from 'commander';
import pc from 'picocolors';
import {
  EXPORT_FORMATS,
  SCHEMA_VERSION,
  allTemplates,
  catalogDocs,
  explainText,
  parseProject,
  runRules,
  searchDocs,
  serializeProject,
} from '@archguide/core';
import type { ExportFormat, Finding, Level, Severity } from '@archguide/core';
import { defaultCatalog, runStdio } from '@archguide/mcp-server';
import { startServer } from '@archguide/server';
import {
  PROJECT_SUFFIX,
  Workspace,
  WorkspaceError,
  exportFiles,
  readFromWorkspace,
  withFileLock,
  writeExport,
  writeFileAtomic,
} from '@archguide/workspace';
import { CliError, EXIT, findAsset } from './io';
import type { Io } from './io';
import { init } from './init';

export const VERSION = '0.0.0';

interface GlobalOptions {
  workspace: string;
  project?: string;
  json?: boolean;
  quiet?: boolean;
}

const LEVELS = ['beginner', 'intermediate', 'senior'] as const;
const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Runs the CLI with `argv` (without node and the script) and returns the exit code. */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  const catalog = defaultCatalog();
  const paint = pc.createColors(io.color ?? false);
  let exitCode: number = EXIT.ok;

  const program = new Command('archguide')
    .description('ArchitectureGuide: the architecture model of a React + Node.js + PostgreSQL repo')
    .version(VERSION)
    .option('-w, --workspace <dir>', 'the architecture folder', './architecture')
    .option('-p, --project <id>', 'project ID (default: the workspace default project)')
    .option('--json', 'machine-readable output')
    .option('-q, --quiet', 'print only results')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err })
    .showHelpAfterError();

  const g = () => program.opts<GlobalOptions>();
  const workspace = () => new Workspace(resolve(io.cwd, g().workspace));
  const info = (text: string) => {
    if (!g().quiet && !g().json) io.out(`${text}\n`);
  };
  const json = (value: unknown) => io.out(`${JSON.stringify(value, null, 2)}\n`);
  const project = async (ws: Workspace) => {
    if (!(await ws.exists()))
      throw new CliError(`No workspace at ${ws.dir}. Run "archguide init" first.`);
    return readFromWorkspace(ws, await ws.resolveProjectId(g().project));
  };
  const shortPath = (path: string) => relative(io.cwd, path) || '.';

  program
    .command('init')
    .description(
      'create architecture/ with config, a project, the Claude Code skill and .gitignore entries',
    )
    .option('-t, --template <code|id>', 'start from a template (see "archguide templates")')
    .option('-n, --name <name>', 'project name (default: the folder name)')
    .option('--id <id>', 'project ID (default: a slug of the name)')
    .option('--no-skill', 'do not copy the skill to .claude/skills/archguide/')
    .action(async (o: { template?: string; name?: string; id?: string; skill: boolean }) => {
      const r = await init(workspace(), catalog, { ...o, cwd: io.cwd });
      if (g().json) return json(r);
      for (const line of r.log) info(`${paint.green('✓')} ${line}`);
      info(`\nNext: ${paint.bold('npx archguide serve')} opens the editor.`);
    });

  program
    .command('serve')
    .description('run the editor on this workspace with live sync for MCP and the CLI')
    .option('--port <port>', 'port (0 picks a free one)', '4317')
    .option('--host <host>', 'host to listen on', '127.0.0.1')
    .option('--open', 'open the browser')
    .option('--no-watch', 'do not reload files changed outside the server')
    .action(async (o: { port: string; host: string; open?: boolean; watch: boolean }) => {
      const ws = workspace();
      if (!(await ws.exists()))
        throw new CliError(`No workspace at ${ws.dir}. Run "archguide init" first.`);
      const index = findAsset('web/index.html', 'apps/web/dist/index.html');
      const webRoot = process.env.ARCHGUIDE_WEB_ROOT ?? (index ? dirname(index) : undefined);
      const server = await startServer({
        workspace: ws,
        catalog,
        host: o.host,
        port: Number(o.port),
        watch: o.watch,
        ...(webRoot ? { webRoot } : {}),
        log: (m) => info(paint.dim(m)),
      });
      if (g().json) json({ url: server.url, port: server.port, token: server.token });
      else {
        info(`ArchGuide serves ${shortPath(ws.dir)} at ${paint.bold(server.url)}`);
        if (!webRoot)
          info(paint.yellow('The web app is not built ("pnpm build"); only the API runs.'));
        info(paint.dim('MCP and CLI writes now go through this server. Ctrl+C stops it.'));
      }
      if (o.open) openBrowser(server.url);
      await new Promise<void>((done) => {
        const stop = () => {
          process.off('SIGINT', stop);
          process.off('SIGTERM', stop);
          done();
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
        io.signal?.addEventListener('abort', stop, { once: true });
      });
      await server.close();
    });

  program
    .command('validate')
    .description('run the architecture rules')
    .addOption(
      new Option('--fail-on <severity>', 'exit with code 1 at this severity or above')
        .choices(['error', 'warning', 'info'])
        .default('error'),
    )
    .option('--include-suppressed', 'list suppressed findings too')
    .action(async (o: { failOn: Severity; includeSuppressed?: boolean }) => {
      const p = await project(workspace());
      const all = runRules(p, catalog);
      const shown = all.filter((f) => o.includeSuppressed || !f.suppressed);
      const failing = all.filter(
        (f) => !f.suppressed && SEVERITY_RANK[f.severity] <= SEVERITY_RANK[o.failOn],
      );
      if (g().json) json({ project: p.id, revision: p.revision, findings: shown });
      else {
        for (const f of shown) io.out(`${formatFinding(f, paint)}\n`);
        const count = (s: Severity) => all.filter((f) => !f.suppressed && f.severity === s).length;
        info(
          `${shown.length ? '\n' : ''}${p.name}: ${count('error')} error(s), ${count('warning')} warning(s), ${count('info')} tip(s)`,
        );
      }
      if (failing.length) exitCode = EXIT.findings;
    });

  program
    .command('export')
    .description(`export the project: ${EXPORT_FORMATS.join(', ')}`)
    .argument('<format>', 'export format')
    .option('--focus <id>', "only this element's neighborhood")
    .option('--depth <n>', 'neighborhood size', (v) => Number(v))
    .addOption(new Option('--level <level>', 'reader level').choices(LEVELS))
    .option('--concept <id>', 'concept-pack: the concept, pattern or template')
    .option('--out <path>', 'write here (relative to the workspace folder)')
    .option('--write', 'write to the path in archguide.config.json, or the default name')
    .action(
      async (
        format: string,
        o: {
          focus?: string;
          depth?: number;
          level?: Level;
          concept?: string;
          out?: string;
          write?: boolean;
        },
      ) => {
        if (!(EXPORT_FORMATS as readonly string[]).includes(format))
          throw new CliError(`Unknown format "${format}". Formats: ${EXPORT_FORMATS.join(', ')}.`);
        const ws = workspace();
        const p = await project(ws);
        const files = exportFiles(ws, p, catalog, format as ExportFormat, {
          ...(o.focus ? { focus: o.focus } : {}),
          ...(o.depth ? { depth: o.depth } : {}),
          ...(o.level ? { level: o.level } : {}),
          ...(o.concept ? { conceptId: o.concept } : {}),
        });
        if (o.write || o.out) {
          const written = await writeExport(ws, p, format as ExportFormat, files, o.out);
          if (g().json) return json({ written });
          for (const path of written) info(`${paint.green('✓')} wrote ${shortPath(path)}`);
          return;
        }
        if (g().json) return json({ files });
        for (const f of files) {
          if (files.length > 1) io.out(`--- ${f.path}\n`);
          io.out(f.content.endsWith('\n') ? f.content : `${f.content}\n`);
        }
      },
    );

  program
    .command('generate')
    .description('enforcement configs: dependency-cruiser, nx, archunit (Phase 8)')
    .argument('<target>', 'dependency-cruiser | nx | archunit')
    .action((target: string) => {
      throw new CliError(
        `"archguide generate ${target}" comes with the enforcement generators (Implementation.md §23.1, Phase 8).`,
      );
    });

  program
    .command('templates')
    .description('list the architecture templates')
    .action(() => {
      const templates = allTemplates(catalog);
      if (g().json)
        return json(
          templates.map(({ id, code, name, summary, parameters }) => ({
            id,
            code,
            name,
            summary,
            parameters,
          })),
        );
      for (const t of templates)
        io.out(
          `${paint.bold(t.code.padEnd(4))} ${t.id.padEnd(28)} ${t.name}\n     ${paint.dim(t.summary)}\n`,
        );
    });

  program
    .command('explain')
    .description('print the learning text for a concept, relation type, rule or topic')
    .argument('<id>', 'for example react.client-store, invokes, RNP-001, topic.transactions')
    .addOption(
      new Option('--level <level>', 'reader level').choices(LEVELS).default('intermediate'),
    )
    .action((id: string, o: { level: Level }) => {
      const text = explainText(catalog, id, o.level);
      if (!text) {
        const like = searchDocs(catalogDocs(catalog), id.replace(/[.-]/g, ' ')).slice(0, 5);
        throw new CliError(
          `No text "${id}".${like.length ? ` Try: ${like.map((d) => d.id).join(', ')}.` : ''}`,
        );
      }
      if (g().json) return json({ id, level: o.level, text });
      io.out(text);
    });

  program
    .command('onboarding')
    .description('write the onboarding pack (ONBOARDING.md)')
    .addOption(
      new Option('--level <level>', 'reader level').choices(LEVELS).default('intermediate'),
    )
    .option('--out <path>', 'where to write (relative to the workspace folder)')
    .option('--stdout', 'print instead of writing')
    .action(async (o: { level: Level; out?: string; stdout?: boolean }) => {
      const ws = workspace();
      const p = await project(ws);
      const files = exportFiles(ws, p, catalog, 'onboarding-md', { level: o.level });
      if (o.stdout) return io.out(files[0]!.content);
      const written = await writeExport(ws, p, 'onboarding-md', files, o.out);
      if (g().json) return json({ written });
      info(`${paint.green('✓')} wrote ${shortPath(written[0]!)}`);
    });

  program
    .command('migrate')
    .description(`upgrade project files to schema version ${SCHEMA_VERSION}`)
    .option('--dry-run', 'only report what would change')
    .action(async (o: { dryRun?: boolean }) => {
      const ws = workspace();
      if (!(await ws.exists()))
        throw new CliError(`No workspace at ${ws.dir}. Run "archguide init" first.`);
      const results: { file: string; from: unknown; to: number; changed: boolean }[] = [];
      for (const file of (await readdir(ws.dir)).filter((f) => f.endsWith(PROJECT_SUFFIX)).sort()) {
        const path = join(ws.dir, file);
        await withFileLock(path, async () => {
          const text = await readFile(path, 'utf8');
          const from = (JSON.parse(text) as { schemaVersion?: unknown }).schemaVersion;
          let next: string;
          try {
            next = serializeProject(parseProject(text));
          } catch (error) {
            throw new CliError(`${file}: ${(error as Error).message}`);
          }
          const changed = next !== text;
          if (changed && !o.dryRun) await writeFileAtomic(path, next);
          results.push({ file, from, to: SCHEMA_VERSION, changed });
        });
      }
      if (g().json) return json(results);
      for (const r of results)
        info(
          r.changed
            ? `${paint.green('✓')} ${r.file}: ${o.dryRun ? 'would upgrade' : 'upgraded'} v${String(r.from)} → v${r.to}`
            : `  ${r.file}: up to date (v${r.to})`,
        );
      if (results.length === 0) info('No project files.');
    });

  program
    .command('mcp')
    .description('start the MCP server on stdio (same as archguide-mcp)')
    .option('--read-only', 'turn off the write tools')
    .action(async (o: { readOnly?: boolean }) => {
      await runStdio({ workspace: workspace().dir, readOnly: o.readOnly ?? false });
    });

  try {
    await program.parseAsync([...argv], { from: 'user' });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? EXIT.ok : EXIT.usage;
    if (error instanceof CliError) {
      io.err(`${paint.red('error')} ${error.message}\n`);
      return error.exitCode;
    }
    if (error instanceof WorkspaceError) {
      io.err(`${paint.red('error')} ${error.message}\n`);
      return EXIT.usage;
    }
    io.err(`${paint.red('internal error')} ${(error as Error).stack ?? String(error)}\n`);
    return EXIT.internal;
  }
}

type Paint = ReturnType<typeof pc.createColors>;

function formatFinding(f: Finding, paint: Paint): string {
  const tag =
    f.severity === 'error'
      ? paint.red('error  ')
      : f.severity === 'warning'
        ? paint.yellow('warning')
        : paint.blue('info   ');
  const suppressed = f.suppressed ? paint.dim(` (suppressed: ${f.suppressed.reason})`) : '';
  const fixes = f.fixes.length
    ? paint.dim(`\n          fix: ${f.fixes.map((x) => x.title).join(' | ')}`)
    : '';
  return `${tag} ${paint.bold(f.ruleId)} ${f.message} ${paint.dim(`[${f.targetIds.join(', ')}]`)}${suppressed}${fixes}`;
}

function openBrowser(url: string) {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, args, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
}
