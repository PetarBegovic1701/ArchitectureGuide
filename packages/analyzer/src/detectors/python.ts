import { posix } from 'node:path';
import type { Evidence, Fact } from '@archguide/core';
import type { Detector, DetectorContext } from '../context';
import { at } from '../context';
import type { PackageInfo } from '../discover';
import type { PyClass, PyIndex } from '../engines/py-index';
import { firstString, kwString, stringsIn } from '../engines/py-index';
import { databaseFact, schemaFact, schemaSubject, tableFacts } from './pg';
import type { TableShape } from './pg';
import { backendServices, serviceResolver } from './targets';
import { deployablesFor, depEvidence, hasDep, packageTitle, pyFiles, title } from './util';

/**
 * Python detectors (Implementation.md §19.4): deployables (FastAPI, Flask, Django …, and
 * Celery, RQ, Dramatiq workers), routes, SQLAlchemy / SQLModel / Django models, Alembic and
 * Django migrations, data access, job brokers, HTTP calls between services, third-party
 * APIs and authentication. The facts are the same as the Node detectors', so data
 * ownership and the analysis rules work across languages.
 */

const isPython = (p: PackageInfo) => p.language === 'python';

const WEB: [dep: string, framework: string, factory: RegExp][] = [
  ['fastapi', 'fastapi', /^(fastapi\.)?FastAPI$/],
  ['django', 'django', /^$/],
  ['flask', 'flask', /^(flask\.)?Flask$/],
  ['litestar', 'litestar', /^(litestar\.)?Litestar$/],
  ['starlette', 'starlette', /^(starlette\.applications\.)?Starlette$/],
  ['aiohttp', 'aiohttp', /^web\.Application$/],
  ['sanic', 'sanic', /^Sanic$/],
  ['tornado', 'tornado', /^(tornado\.)?web\.Application$/],
];
const SERVERS = ['uvicorn', 'gunicorn', 'hypercorn', 'daphne', 'granian'];
const JOB_LIBS = ['celery', 'rq', 'dramatiq', 'arq', 'huey'];
const DATA_ACCESS: [dep: string, value: string][] = [
  ['sqlmodel', 'sqlmodel'],
  ['sqlalchemy', 'sqlalchemy'],
  ['flask-sqlalchemy', 'sqlalchemy'],
  ['django', 'django-orm'],
  ['tortoise-orm', 'tortoise'],
  ['peewee', 'peewee'],
  ['asyncpg', 'asyncpg'],
  ['psycopg', 'psycopg'],
  ['psycopg2', 'psycopg'],
  ['psycopg2-binary', 'psycopg'],
];
const PG_DRIVERS = [
  'psycopg',
  'psycopg2',
  'psycopg2-binary',
  'psycopg-binary',
  'asyncpg',
  'pg8000',
];

/** The deployable fact of the context's package, when it is a Python deployable. */
const deployableOf = (ctx: DetectorContext, p: PackageInfo = ctx.pkg) =>
  ctx.facts.find(
    (f) =>
      f.type === 'deployable' &&
      f.subject === ctx.pkgSubject(p) &&
      f.element?.kind.startsWith('py.'),
  );

async function indexes(ctx: DetectorContext, files: string[]) {
  const out: { file: string; index: PyIndex }[] = [];
  for (const file of files) {
    const index = await ctx.engines.py(file);
    if (index) out.push({ file, index });
  }
  return out;
}

const filesOf = (ctx: DetectorContext, p: PackageInfo) =>
  ctx.engines.repo.files.filter((f) => p.dir === '' || f.startsWith(`${p.dir}/`));

/** Python files of a package (not only the context's), without tests and migrations. */
const pyFilesOf = (ctx: DetectorContext, p: PackageInfo) =>
  pyFiles({ ...ctx, files: filesOf(ctx, p) });

// --- deployables -----------------------------------------------------------------------

/** `py.deployable`: Python web services and background workers. */
const deployable: Detector = {
  id: 'py.deployable',
  appliesTo: isPython,
  async run(ctx) {
    const p = ctx.pkg;
    const files = await indexes(ctx, pyFiles(ctx));
    const base = p.dir ? `${p.dir}/` : '';
    let web: { framework: string; dep: string; evidence: Evidence } | undefined;
    for (const [dep, framework, factory] of WEB) {
      if (!hasDep(p, dep)) continue;
      if (framework === 'django') {
        const manage = ctx.files.find((f) => f === `${base}manage.py`);
        if (manage) web = { framework, dep, evidence: at(manage, 1, 'manage.py') };
      } else
        for (const { file, index } of files) {
          const call = index.calls.find((c) => factory.test(c.callee));
          if (call) {
            web = { framework, dep, evidence: at(file, call.line, call.callee) };
            break;
          }
        }
      if (web) break;
    }
    const server = SERVERS.find((s) => hasDep(p, s));
    const dataAccess = DATA_ACCESS.find(([dep]) => hasDep(p, dep))?.[1];
    const common = {
      ...(p.python?.pythonVersion ? { pythonVersion: p.python.pythonVersion } : {}),
      ...(dataAccess ? { dataAccess } : {}),
    };
    if (web)
      return [
        {
          type: 'deployable',
          subject: ctx.pkgSubject(p),
          data: { role: 'service', framework: web.framework, language: 'python' },
          evidence: [await depEvidence(ctx, p, web.dep), web.evidence],
          confidence: 0.9,
          detector: 'py.deployable',
          element: {
            kind: 'py.service',
            name: packageTitle(p),
            codePaths: [p.dir || '.'],
            tech: `Python + ${web.framework === 'fastapi' ? 'FastAPI' : title(web.framework)}`,
            properties: { framework: web.framework, ...(server ? { server } : {}), ...common },
          },
        },
      ];
    // A worker defines tasks; a package that only sends them is not one.
    const jobLib = JOB_LIBS.find((d) => hasDep(p, d));
    if (!jobLib) return [];
    for (const { file, index } of files) {
      const task =
        index.decorators.find((d) =>
          /(^|\.)(task|shared_task|actor|periodic_task)$/.test(d.callee),
        ) ??
        (jobLib === 'arq' ? index.classes.find((c) => c.name === 'WorkerSettings') : undefined) ??
        (jobLib === 'rq' ? index.calls.find((c) => /(^|\.)Worker$/.test(c.callee)) : undefined);
      if (!task) continue;
      return [
        {
          type: 'deployable',
          subject: ctx.pkgSubject(p),
          data: { role: 'worker', jobLib, language: 'python' },
          evidence: [await depEvidence(ctx, p, jobLib), at(file, task.line, jobLib)],
          confidence: 0.85,
          detector: 'py.worker',
          element: {
            kind: 'py.worker',
            name: packageTitle(p),
            codePaths: [p.dir || '.'],
            tech: `Python + ${title(jobLib)}`,
            properties: { jobLib, ...common },
          },
        },
      ];
    }
    return [];
  },
};

// --- routes ----------------------------------------------------------------------------

const ROUTER_FACTORY =
  /^(fastapi\.)?(FastAPI|APIRouter)$|^(flask\.)?(Flask|Blueprint)$|^(Starlette|Litestar|Router|Sanic)$/;
const DECORATOR_METHODS = /^(get|post|put|patch|delete|options|head|route|api_route|websocket)$/;

const joinPath = (...parts: string[]) =>
  `/${parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')}`;

/** The file a module name points at, inside the package: "app.api.orders" → app/api/orders.py. */
function moduleFile(files: readonly string[], from: string, module: string, level = 0) {
  const rel = module.replace(/\./g, '/');
  const dir = level ? posix.join(posix.dirname(from), ...Array(level - 1).fill('..')) : '';
  const candidates = [`${rel}.py`, `${rel}/__init__.py`].map((c) => (dir ? posix.join(dir, c) : c));
  return files.find((f) => candidates.some((c) => f === c || f.endsWith(`/${c}`)));
}

/** `py.routes`: one route handler per file that defines routes (FastAPI, Flask, Django …). */
const routes: Detector = {
  id: 'py.routes',
  appliesTo: isPython,
  async run(ctx) {
    const service = deployableOf(ctx);
    if (!service || service.element?.kind !== 'py.service') return [];
    const framework = String(service.data.framework);
    const all = await indexes(ctx, pyFiles(ctx));
    const files = all.map((x) => x.file);
    // Mount prefixes: include_router(x.router, prefix=…), register_blueprint(bp, url_prefix=…).
    const mounts = new Map<string, string>();
    for (const { file, index } of all)
      for (const c of index.calls) {
        if (!/(^|\.)(include_router|register_blueprint|mount)$/.test(c.callee)) continue;
        const prefix = kwString(c.args, 'prefix') ?? kwString(c.args, 'url_prefix') ?? '';
        const target = /^\s*([A-Za-z_][\w.]*)/.exec(c.args)?.[1]?.split('.')[0];
        const imp =
          target && index.imports.find((i) => i.names.includes(target) || i.alias === target);
        if (!imp) continue;
        const mod = imp.names.includes(target)
          ? (moduleFile(files, file, `${imp.module}.${target}`, imp.level) ??
            moduleFile(files, file, imp.module, imp.level))
          : moduleFile(files, file, imp.module, imp.level);
        if (mod) mounts.set(mod, prefix);
      }
    const out: Fact[] = [];
    const add = (
      file: string,
      list: { method: string; path: string; line: number }[],
      validation?: string,
    ) => {
      if (!list.length) return;
      const stem = posix.basename(file, '.py');
      const name = /^(main|app|__init__|urls|views|routes|api|server)$/.test(stem)
        ? posix.basename(posix.dirname(file))
        : stem;
      const routeList = list.map((r) => `${r.method} ${r.path}`);
      out.push({
        type: 'handler',
        subject: `handler:${file}`,
        data: { framework, file, validation: validation ?? null, routes: routeList },
        evidence: list.slice(0, 5).map((r) => at(file, r.line, `${r.method} ${r.path}`)),
        confidence: 0.85,
        detector: 'py.routes',
        element: {
          kind: 'node.route-handler',
          name:
            name === posix.basename(ctx.pkg.dir) || name === 'app' || name === 'src'
              ? `${service.element!.name} routes`
              : `${title(name)} routes`,
          parent: service.subject,
          codePaths: [file],
          properties: {
            routes: routeList,
            language: 'python',
            ...(validation ? { validation } : {}),
          },
        },
      });
    };

    if (framework === 'django') {
      // urls.py: path("x/", view) and include("app.urls") with its prefix.
      const urlFiles = all.filter(({ file }) => posix.basename(file) === 'urls.py');
      const prefixOf = new Map<string, string>();
      for (const { file, index } of urlFiles)
        for (const c of index.calls.filter((x) => /^(re_)?path$/.test(x.callee))) {
          const inc = /include\s*\(\s*"([\w.]+)"/.exec(c.args)?.[1];
          const mod = inc && moduleFile(files, file, inc);
          if (mod) prefixOf.set(mod, joinPath(prefixOf.get(file) ?? '', firstString(c.args) ?? ''));
        }
      for (const { file, index } of urlFiles) {
        const list = index.calls
          .filter((c) => /^(re_)?path$/.test(c.callee) && !/include\s*\(/.test(c.args))
          .flatMap((c) => {
            const p = firstString(c.args);
            return p === undefined
              ? []
              : [{ method: 'ANY', path: joinPath(prefixOf.get(file) ?? '', p), line: c.line }];
          });
        const views = moduleFile(files, file, 'views', 1);
        const viewIndex = all.find((x) => x.file === views)?.index;
        const validation = [index, viewIndex].some((i) =>
          i?.imports.some(
            (x) =>
              /^(rest_framework|django\.forms)/.test(x.module) || x.names.includes('serializers'),
          ),
        )
          ? 'django-forms'
          : undefined;
        add(file, list, validation);
      }
      return out;
    }

    for (const { file, index } of all) {
      const routers = new Map<string, string>();
      for (const a of index.assigns) {
        const m = /^([A-Za-z_][\w.]*)\s*\(/.exec(a.value);
        if (m && ROUTER_FACTORY.test(m[1]!)) {
          const args = a.value.slice(a.value.indexOf('(') + 1);
          routers.set(a.name, kwString(args, 'prefix') ?? kwString(args, 'url_prefix') ?? '');
        }
      }
      const list = index.decorators.flatMap((d) => {
        const [obj, method] = d.callee.split('.');
        if (!obj || !method || !routers.has(obj) || !DECORATOR_METHODS.test(method)) return [];
        const path = firstString(d.args);
        if (path === undefined) return [];
        const methods =
          method === 'route' || method === 'api_route'
            ? /methods\s*=\s*\[([^\]]*)\]/.exec(d.args)?.[1]
              ? stringsIn(/methods\s*=\s*\[([^\]]*)\]/.exec(d.args)![1]!)
              : ['GET']
            : [method === 'websocket' ? 'GET' : method];
        const full = joinPath(mounts.get(file) ?? '', routers.get(obj)!, path);
        return methods.map((m) => ({ method: m.toUpperCase(), path: full, line: d.line }));
      });
      const pydantic = index.imports.some((i) => /^(pydantic|sqlmodel)/.test(i.module));
      const validation =
        framework === 'fastapi' || framework === 'litestar'
          ? 'pydantic'
          : pydantic
            ? 'pydantic'
            : index.imports.some((i) => /^marshmallow/.test(i.module))
              ? 'marshmallow'
              : undefined;
      add(file, list, validation);
    }
    return out;
  },
};

// --- data ------------------------------------------------------------------------------

interface PyModel {
  cls: string;
  table: string;
  schema: string;
  file: string;
  line: number;
  pkg: PackageInfo;
  shape: TableShape;
}

const str = (value: string) => /^"((?:[^"\\]|\\.)*)"$/.exec(value.trim())?.[1];

/** SQLAlchemy, SQLModel and Django models of one module. */
function modelsOf(file: string, index: PyIndex, pkg: PackageInfo): PyModel[] {
  const out: PyModel[] = [];
  const django = index.imports.some((i) => i.module === 'django.db');
  for (const cls of index.classes) {
    const field = (name: string) => cls.fields.find((f) => f.name === name);
    let table = field('__tablename__') && str(field('__tablename__')!.value);
    const isSqlModel = cls.bases.some((b) => /table\s*=\s*True/.test(b));
    const isDjango = django && cls.bases.some((b) => /^(models\.)?Model$/.test(b));
    if (!table && isSqlModel) table = cls.name.toLowerCase();
    if (!table && isDjango) {
      const parts = file.split('/');
      const app =
        parts[parts.length - 2] === 'models' ? parts[parts.length - 3] : parts[parts.length - 2];
      table = (cls.meta.db_table && str(cls.meta.db_table)) ?? `${app}_${cls.name.toLowerCase()}`;
    }
    if (!table) continue;
    const args = field('__table_args__')?.value ?? '';
    const schema = /"schema"\s*:\s*"([^"]+)"/.exec(args)?.[1] ?? 'public';
    out.push({
      cls: cls.name,
      table,
      schema,
      file,
      line: cls.line,
      pkg,
      shape: shapeOf(cls, table, schema, file, isDjango),
    });
  }
  return out;
}

function shapeOf(
  cls: PyClass,
  table: string,
  schema: string,
  file: string,
  django: boolean,
): TableShape {
  const columns: TableShape['columns'] = [];
  const primaryKey: string[] = django ? ['id'] : [];
  const foreignKeys: TableShape['foreignKeys'] = [];
  const indexes: TableShape['indexes'] = [];
  if (django) columns.push({ name: 'id', type: 'bigint' });
  for (const f of cls.fields) {
    if (f.name.startsWith('__') || f.name === 'objects') continue;
    const mapped = /Mapped\[\s*(?:Optional\[)?([\w.]+)/.exec(f.annotation ?? '')?.[1];
    const ctor =
      /^(?:sa\.|models\.|db\.)?(Column|mapped_column|Field|\w+Field|ForeignKey|OneToOneField)\s*\(/.exec(
        f.value,
      );
    if (!mapped && !ctor) continue;
    let name = f.name;
    const fk =
      /ForeignKey\s*\(\s*"([\w.]+)"/.exec(f.value)?.[1] ??
      (django &&
      /^(models\.)?(ForeignKey|OneToOneField)\s*\(\s*(?:"([\w.]+)"|([\w.]+))/.exec(f.value)
        ? `model:${/^(?:models\.)?(?:ForeignKey|OneToOneField)\s*\(\s*(?:"([\w.]+)"|([\w.]+))/.exec(f.value)!.slice(1).find(Boolean)}`
        : undefined);
    if (django && fk) name = `${f.name}_id`;
    const type =
      mapped ??
      /^(?:models\.)?(\w+)Field/.exec(f.value)?.[1]?.toLowerCase() ??
      /Column\s*\(\s*(?:sa\.)?(\w+)/.exec(f.value)?.[1] ??
      'unknown';
    columns.push({ name, type });
    if (/primary_key\s*=\s*True/.test(f.value)) primaryKey.push(name);
    if (/(\bindex|db_index)\s*=\s*True|unique\s*=\s*True/.test(f.value))
      indexes.push({
        columns: [name],
        ...(/unique\s*=\s*True/.test(f.value) ? { unique: true } : {}),
        line: f.line,
      });
    if (fk) {
      const parts = fk.startsWith('model:') ? [] : fk.split('.');
      foreignKeys.push({
        columns: [name],
        references: fk.startsWith('model:')
          ? fk
          : parts.length >= 3
            ? `${parts[0]}.${parts[1]}`
            : `public.${parts[0]}`,
        refColumns: [fk.startsWith('model:') ? 'id' : (parts[parts.length - 1] ?? 'id')],
        line: f.line,
      });
    }
  }
  // Index("name", "col", …) in __table_args__.
  const args = cls.fields.find((f) => f.name === '__table_args__')?.value ?? '';
  for (const m of args.matchAll(/Index\s*\(([^)]*)\)/g)) {
    const cols = stringsIn(m[1]!).slice(1);
    if (cols.length) indexes.push({ columns: cols, line: cls.line });
  }
  return {
    schema,
    table,
    model: cls.name,
    columns,
    primaryKey,
    foreignKeys,
    indexes,
    file,
    line: cls.line,
  };
}

const SQL_TARGET =
  /\b(FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+"?([A-Za-z_]\w*)"?(?:\."?([A-Za-z_]\w*)"?)?/gi;

/** Reads and writes of one module: ORM calls on known models, and SQL in strings. */
function usagesOf(index: PyIndex, models: ReadonlyMap<string, PyModel>) {
  const out: { target: string; op: 'read' | 'write'; orm: string; line: number }[] = [];
  const known = (name: string | undefined) => (name && models.has(name) ? name : undefined);
  const firstArg = (args: string) => /^\s*([A-Za-z_]\w*)/.exec(args)?.[1];
  const adds = index.calls.some((c) =>
    /(^|\.)(add|add_all|merge|bulk_save_objects)$/.test(c.callee),
  );
  for (const c of index.calls) {
    let m: RegExpExecArray | null;
    if (/(^|\.)(select|query)$/.test(c.callee) && known(firstArg(c.args)))
      out.push({ target: firstArg(c.args)!, op: 'read', orm: 'sqlalchemy', line: c.line });
    else if (/(^|\.)get$/.test(c.callee) && /session|db/i.test(c.callee) && known(firstArg(c.args)))
      out.push({ target: firstArg(c.args)!, op: 'read', orm: 'sqlalchemy', line: c.line });
    else if (/(^|\.)(insert|update|delete)$/.test(c.callee) && known(firstArg(c.args)))
      out.push({ target: firstArg(c.args)!, op: 'write', orm: 'sqlalchemy', line: c.line });
    else if (adds && known(c.callee))
      out.push({ target: c.callee, op: 'write', orm: 'sqlalchemy', line: c.line });
    else if ((m = /^([A-Za-z_]\w*)\.objects\.(\w+)$/.exec(c.callee)) && known(m[1])) {
      const write =
        /^(create|bulk_create|update|bulk_update|update_or_create|get_or_create|delete)$/.test(
          m[2]!,
        );
      out.push({ target: m[1]!, op: write ? 'write' : 'read', orm: 'django-orm', line: c.line });
    }
  }
  // queryset = Product.objects.all() in a class body (Django views).
  for (const s of index.strings) {
    if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(s.value)) continue;
    for (const m of s.value.matchAll(SQL_TARGET)) {
      const write = !/^(FROM|JOIN)$/i.test(m[1]!);
      out.push({
        target: m[3] ? `${m[2]}.${m[3]}` : m[2]!,
        op: write ? 'write' : 'read',
        orm: 'sql',
        line: s.line,
      });
    }
  }
  return out;
}

/** `py.data` (repository scope): tables, schemas, the database, data access and migrations. */
const data: Detector = {
  id: 'py.data',
  scope: 'repo',
  async run(ctx) {
    const out: Fact[] = [];
    const packages = ctx.packages.filter(isPython);
    const models: PyModel[] = [];
    const perPackage = new Map<PackageInfo, { file: string; index: PyIndex }[]>();
    for (const p of packages) {
      const list = await indexes(ctx, pyFilesOf(ctx, p));
      perPackage.set(p, list);
      for (const { file, index } of list) models.push(...modelsOf(file, index, p));
    }
    const byClass = new Map(models.map((m) => [m.cls, m]));
    const postgres = async (p: PackageInfo) => {
      if (PG_DRIVERS.some((d) => hasDep(p, d))) return true;
      for (const { index } of perPackage.get(p) ?? [])
        if (
          index.strings.some((s) =>
            /django\.db\.backends\.postgresql|^postgres(ql)?(\+\w+)?:\/\//.test(s.value),
          )
        )
          return true;
      return false;
    };
    const pgPackages = new Set<PackageInfo>();
    for (const p of packages) if (await postgres(p)) pgPackages.add(p);

    if (models.length && pgPackages.size) {
      const first = models[0]!;
      out.push(await databaseFact(ctx, [at(first.file, first.line, first.cls)], 'py.data'));
      for (const schema of [...new Set(models.map((m) => m.schema))].sort()) {
        const m = models.find((x) => x.schema === schema)!;
        out.push(schemaFact(schema, [at(m.file, m.line, m.cls)], 'py.data'));
      }
      for (const m of models) {
        // Django foreign keys name a model: point them at its table.
        m.shape.foreignKeys = m.shape.foreignKeys.map((fk) => {
          if (!fk.references.startsWith('model:')) return fk;
          const target = byClass.get(fk.references.slice(6).split('.').pop()!);
          return { ...fk, references: target ? `${target.schema}.${target.table}` : '?' };
        });
        out.push(...tableFacts(m.shape, 'py.data', 0.85));
      }
    }

    for (const p of packages) {
      const owners = deployablesFor(ctx, p);
      if (!owners.length) continue;
      const lib = DATA_ACCESS.find(([dep]) => hasDep(p, dep))?.[1];
      for (const { file, index } of perPackage.get(p) ?? [])
        for (const u of usagesOf(index, byClass)) {
          const model = byClass.get(u.target);
          for (const deployable of owners)
            out.push({
              type: 'orm-usage',
              subject: `use:${deployable}:${file}:${u.line}:${u.target}`,
              data: {
                deployable,
                target: model ? model.cls : u.target,
                op: u.op,
                orm: u.orm === 'sqlalchemy' && lib === 'sqlmodel' ? 'sqlmodel' : u.orm,
                file,
              },
              evidence: [at(file, u.line, `${u.target} (${u.op})`)],
              confidence: 0.8,
              detector: 'py.data',
            });
        }
      out.push(...(await migrationsOf(ctx, p, owners)));
    }
    return out;
  },
};

/** Alembic (`op.create_table`) and Django (`migrations.CreateModel`) migrations of a package. */
async function migrationsOf(
  ctx: DetectorContext,
  p: PackageInfo,
  owners: string[],
): Promise<Fact[]> {
  const files = filesOf(ctx, p).filter((f) => f.endsWith('.py'));
  const alembic = files.filter((f) => /(^|\/)(alembic|migrations)\/versions\/[^/]+\.py$/.test(f));
  const django = files.filter(
    (f) => /(^|\/)migrations\/\d{4}_[^/]+\.py$/.test(f) && !alembic.includes(f),
  );
  const out: Fact[] = [];
  const self = ctx.pkgSubject(p);
  const deployable = owners.includes(self) ? self : owners.length === 1 ? owners[0]! : undefined;
  if (!deployable) return out;
  for (const [tool, list] of [
    ['alembic', alembic],
    ['django', django],
  ] as const) {
    if (!list.length) continue;
    const tables = new Set<string>();
    const schemas = new Set<string>();
    for (const f of list) {
      const index = await ctx.engines.py(f);
      for (const c of index?.calls ?? []) {
        if (
          tool === 'alembic' &&
          /^op\.(create_table|add_column|alter_column|drop_table|create_index)$/.test(c.callee)
        ) {
          const name = firstString(c.args);
          const schema = kwString(c.args, 'schema');
          if (name && !/create_index/.test(c.callee)) tables.add(`${schema ?? 'public'}.${name}`);
          if (schema) schemas.add(schemaSubject(schema));
        }
        if (tool === 'alembic' && /^op\.execute$/.test(c.callee)) {
          const s = /CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)/i.exec(
            firstString(c.args) ?? '',
          );
          if (s) schemas.add(schemaSubject(s[1]!));
        }
        if (tool === 'django' && /(^|\.)CreateModel$/.test(c.callee)) {
          const name = kwString(c.args, 'name');
          const app = f.split('/').slice(-3, -2)[0];
          const dbTable = /"db_table"\s*:\s*"([^"]+)"/.exec(c.args)?.[1];
          if (name) tables.add(`public.${dbTable ?? `${app}_${name.toLowerCase()}`}`);
        }
      }
    }
    out.push({
      type: 'migrations',
      subject: `migrations:${self}:${tool}`,
      data: { deployable, tool, tables: [...tables].sort(), schemas: [...schemas].sort() },
      evidence: list.slice(0, 5).map((f) => at(f, 1)),
      confidence: 0.9,
      detector: 'py.data',
    });
  }
  return out;
}

// --- jobs ------------------------------------------------------------------------------

const BROKERS: [RegExp, string][] = [
  [/^rediss?:/, 'Redis'],
  [/^(amqps?|pyamqp):/, 'RabbitMQ'],
  [/^sqs:/, 'Amazon SQS'],
  [/^kafka:/, 'Kafka'],
];

/**
 * `py.jobs` (repository scope): the broker of Celery, RQ, Dramatiq and arq, the workers
 * that consume it and the services that send jobs to it.
 */
const jobs: Detector = {
  id: 'py.jobs',
  scope: 'repo',
  async run(ctx) {
    const out: Fact[] = [];
    const env = await ctx.engines.env();
    const compose = await ctx.engines.compose();
    /** The scheme of the URL an environment variable holds ("redis", "amqp"). */
    const schemeOf = (name: string) =>
      env.find((e) => e.name === name)?.url?.scheme ??
      compose.flatMap((c) => c.services.flatMap((s) => s.urls)).find((u) => u.name === name)
        ?.scheme;
    for (const p of ctx.packages.filter(isPython)) {
      const lib = JOB_LIBS.find((d) => hasDep(p, d));
      const owner = backendServices(ctx).find((s) => s.subject === ctx.pkgSubject(p));
      if (!lib || !owner) continue;
      const files = await indexes(ctx, pyFilesOf(ctx, p));
      let product: string | undefined;
      let evidence: Evidence | undefined;
      let sends: Evidence | undefined;
      for (const { file, index } of files) {
        for (const c of index.calls) {
          if (
            /(^|\.)(Celery|Redis|from_url|RedisBroker|RabbitmqBroker)$/.test(c.callee) &&
            !product
          ) {
            const literal = stringsIn(c.args).find((s) => /^\w+:\/\//.test(s));
            const envName =
              /os\.(?:environ\s*\[\s*|getenv\s*\(\s*|environ\.get\s*\(\s*)"(\w+)"/.exec(
                c.args,
              )?.[1] ?? /settings\.(\w+)/.exec(c.args)?.[1]?.toUpperCase();
            const scheme = literal ?? (envName ? `${schemeOf(envName) ?? ''}:` : undefined);
            product =
              (scheme && BROKERS.find(([re]) => re.test(scheme))?.[1]) ??
              (/Rabbitmq/.test(c.callee) ? 'RabbitMQ' : undefined);
            evidence = at(file, c.line, c.callee);
          }
          if (
            /(^|\.)(delay|apply_async|send_task|enqueue|enqueue_job|send)$/.test(c.callee) &&
            !/^(self|SendGridAPIClient)/.test(c.callee) &&
            !sends
          )
            sends = at(file, c.line, c.callee);
        }
      }
      product ??= lib === 'rq' || lib === 'arq' ? 'Redis' : undefined;
      if (!product) {
        const image = compose
          .flatMap((c) => c.services)
          .find((s) => /(^|\/)(redis|rabbitmq)(:|$)/.test(s.image ?? ''));
        product = image
          ? /redis/.test(image.image!)
            ? 'Redis'
            : 'RabbitMQ'
          : `${title(lib)} broker`;
      }
      const subject = `broker:${product.toLowerCase().replace(/\W+/g, '-')}`;
      const ev = evidence ?? (await depEvidence(ctx, p, lib));
      out.push({
        type: 'job-queue',
        subject,
        data: { product, lib },
        evidence: [ev],
        confidence: 0.75,
        detector: 'py.jobs',
        element: { kind: 'gen.other-broker', name: product, properties: { product } },
      });
      if (owner.element?.kind === 'py.worker')
        out.push({
          type: 'job-consumer',
          subject: `consumer:${owner.subject}:${subject}`,
          data: { lib },
          evidence: [ev],
          confidence: 0.8,
          detector: 'py.jobs',
          relation: { type: 'consumes', from: owner.subject, to: subject, via: lib },
        });
      else if (sends)
        out.push({
          type: 'job-producer',
          subject: `producer:${owner.subject}:${subject}`,
          data: { lib },
          evidence: [sends],
          confidence: 0.8,
          detector: 'py.jobs',
          relation: { type: 'publishes', from: owner.subject, to: subject, via: lib },
        });
    }
    return out;
  },
};

// --- HTTP calls, third-party APIs and auth --------------------------------------------

const HTTP_CALL =
  /^(httpx|requests|aiohttp|session|client|self\.client|self\.http|http)?\.?(get|post|put|patch|delete|request|stream)$|^(httpx|requests)\.\w+$/;

/** Environment variable names a call's arguments read, directly or through settings. */
function envNamesIn(args: string, index: PyIndex): string[] {
  const names = new Set<string>();
  for (const m of args.matchAll(
    /os\.(?:environ\s*\[\s*|getenv\s*\(\s*|environ\.get\s*\(\s*)"(\w+)"/g,
  ))
    names.add(m[1]!);
  for (const m of args.matchAll(/\bsettings\.(\w+)/g)) names.add(m[1]!.toUpperCase());
  const fromEnv = new Map(
    index.assigns.flatMap((a) => {
      const m = /os\.(?:environ\s*\[\s*|getenv\s*\(\s*|environ\.get\s*\(\s*)"(\w+)"/.exec(a.value);
      return m ? [[a.name, m[1]!] as const] : [];
    }),
  );
  for (const m of args.matchAll(/\b([A-Z][A-Z0-9_]+)\b/g))
    if (fromEnv.has(m[1]!)) names.add(fromEnv.get(m[1]!)!);
  return [...names];
}

/** `py.http-calls` (repository scope): httpx / requests / aiohttp calls to other services. */
const httpCalls: Detector = {
  id: 'py.http-calls',
  scope: 'repo',
  async run(ctx) {
    const services = backendServices(ctx);
    const callers = services.filter((s) => s.element?.kind.startsWith('py.'));
    if (services.length < 2 || !callers.length) return [];
    const resolve = await serviceResolver(ctx, services);
    const out: Fact[] = [];
    for (const from of callers) {
      const p = ctx.packages.find((x) => ctx.pkgSubject(x) === from.subject);
      if (!p) continue;
      for (const { file, index } of await indexes(ctx, pyFilesOf(ctx, p))) {
        if (!index.imports.some((i) => /^(httpx|requests|aiohttp)/.test(i.module))) continue;
        for (const c of index.calls) {
          if (!HTTP_CALL.test(c.callee)) continue;
          for (const name of envNamesIn(c.args, index)) {
            const to = resolve(name);
            if (!to || to === from.subject) continue;
            out.push({
              type: 'http-call',
              subject: `call:${from.subject}->${to}`,
              data: { from: from.subject, to, env: name },
              evidence: [at(file, c.line, name)],
              confidence: 0.75,
              detector: 'py.http-calls',
              relation: { type: 'calls', from: from.subject, to, protocol: 'http' },
            });
          }
        }
      }
    }
    return out;
  },
};

const SDKS: [RegExp, string][] = [
  [/^stripe$/, 'Stripe'],
  [/^sendgrid$/, 'SendGrid'],
  [/^(boto3|aioboto3|botocore)$/, 'AWS'],
  [/^anthropic$/, 'Anthropic API'],
  [/^openai$/, 'OpenAI API'],
  [/^twilio$/, 'Twilio'],
  [/^resend$/, 'Resend'],
  [/^slack_sdk$/, 'Slack'],
  [/^google\.cloud/, 'Google Cloud'],
  [/^postmarker$/, 'Postmark'],
  [/^sentry_sdk$/, 'Sentry'],
];

/** `py.external-sdk`: third-party APIs a deployable calls, from its imports. */
const externalSdk: Detector = {
  id: 'py.external-sdk',
  appliesTo: isPython,
  async run(ctx) {
    const owners = deployablesFor(ctx, ctx.pkg);
    if (!owners.length) return [];
    const out: Fact[] = [];
    for (const { file, index } of await indexes(ctx, pyFiles(ctx)))
      for (const imp of index.imports) {
        const sdk = SDKS.find(([re]) => re.test(imp.module));
        if (!sdk) continue;
        const subject = `ext:${sdk[1]}`;
        out.push({
          type: 'external-sdk',
          subject,
          data: { sdk: imp.module },
          evidence: [at(file, imp.line, imp.module)],
          confidence: 0.85,
          detector: 'py.external-sdk',
          element: { kind: 'gen.external', name: sdk[1] },
        });
        for (const owner of owners)
          out.push({
            type: 'external-sdk',
            subject: `${owner}->${subject}`,
            data: { sdk: imp.module },
            evidence: [at(file, imp.line, imp.module)],
            confidence: 0.85,
            detector: 'py.external-sdk',
            relation: { type: 'calls', from: owner, to: subject, protocol: 'https' },
          });
      }
    return out;
  },
};

const AUTH: { dep: string; method: 'jwt' | 'session'; provider?: string }[] = [
  { dep: 'python-jose', method: 'jwt' },
  { dep: 'pyjwt', method: 'jwt' },
  { dep: 'authlib', method: 'jwt' },
  { dep: 'fastapi-users', method: 'jwt' },
  { dep: 'djangorestframework-simplejwt', method: 'jwt' },
  { dep: 'flask-jwt-extended', method: 'jwt' },
  { dep: 'flask-login', method: 'session' },
  { dep: 'django-allauth', method: 'session' },
  { dep: 'auth0-python', method: 'jwt', provider: 'Auth0' },
  { dep: 'firebase-admin', method: 'jwt', provider: 'Firebase Auth' },
  { dep: 'supabase', method: 'jwt', provider: 'Supabase Auth' },
  { dep: 'clerk-backend-api', method: 'jwt', provider: 'Clerk' },
];

/** `py.auth`: authentication in a Python service, and the identity provider behind it. */
const auth: Detector = {
  id: 'py.auth',
  appliesTo: (p) => isPython(p) && AUTH.some((a) => p.deps.has(a.dep)),
  async run(ctx) {
    const service = deployableOf(ctx);
    if (!service || service.element?.kind !== 'py.service') return [];
    const found = AUTH.filter((a) => ctx.pkg.deps.has(a.dep));
    const evidence = await Promise.all(found.map((a) => depEvidence(ctx, ctx.pkg, a.dep)));
    const out: Fact[] = [
      {
        type: 'middleware',
        subject: `mw:${service.subject}:auth`,
        data: { kind: 'auth', libs: found.map((a) => a.dep) },
        evidence,
        confidence: 0.75,
        detector: 'py.auth',
        element: {
          kind: 'node.middleware',
          name: 'Auth middleware',
          parent: service.subject,
          properties: { kind: 'auth', authMethod: found[0]!.method },
        },
      },
    ];
    for (const a of found.filter((x) => x.provider)) {
      const subject = `idp:${a.provider}`;
      const ev = [await depEvidence(ctx, ctx.pkg, a.dep)];
      out.push(
        {
          type: 'external-sdk',
          subject,
          data: { provider: a.provider },
          evidence: ev,
          confidence: 0.8,
          detector: 'py.auth',
          element: { kind: 'gen.auth-provider', name: a.provider! },
        },
        {
          type: 'external-sdk',
          subject: `${service.subject}->${subject}`,
          data: {},
          evidence: ev,
          confidence: 0.8,
          detector: 'py.auth',
          relation: { type: 'authenticates-with', from: service.subject, to: subject },
        },
      );
    }
    return out;
  },
};

/** Deployables first (the libraries detector needs them), then the rest. */
export const PYTHON_DEPLOYABLE_DETECTORS: Detector[] = [deployable];
export const PYTHON_DETECTORS: Detector[] = [routes, auth, externalSdk, data, jobs, httpCalls];
