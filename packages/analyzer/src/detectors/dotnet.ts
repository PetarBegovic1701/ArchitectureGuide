import { posix } from 'node:path';
import type { Evidence, Fact } from '@archguide/core';
import type { Detector, DetectorContext } from '../context';
import { at } from '../context';
import type { PackageInfo } from '../discover';
import { manifestOf } from '../discover';
import type { CsClass, CsIndex } from '../engines/cs-index';
import { csNamedString } from '../engines/cs-index';
import { isTestProject } from './libraries';
import { databaseFact, schemaFact, schemaSubject, tableFacts } from './pg';
import { backendServices, serviceResolver } from './targets';
import {
  deployablesFor,
  depEvidence,
  dotnetFiles,
  languageProp,
  packageTitle,
  title,
} from './util';

/**
 * .NET detectors (Implementation.md §19.4): ASP.NET Core services (controllers, minimal
 * APIs, gRPC), worker services, EF Core contexts and migrations, Dapper and SQL, MassTransit
 * and Hangfire messaging, HTTP clients between services, third-party SDKs and authentication.
 * Class libraries are handled by `lang.libs` (module of one deployable, or shared package).
 */

const isDotnet = (p: PackageInfo) => p.language === 'dotnet' && !isTestProject(p);
const has = (p: PackageInfo, re: RegExp) => [...p.deps].some((d) => re.test(d));

const filesOf = (ctx: DetectorContext, p: PackageInfo) =>
  dotnetFiles({
    ...ctx,
    files: ctx.engines.repo.files.filter((f) => p.dir === '' || f.startsWith(`${p.dir}/`)),
  });

async function indexes(ctx: DetectorContext, files: string[]) {
  const out: { file: string; index: CsIndex }[] = [];
  for (const file of files) {
    const index = await ctx.engines.cs(file);
    if (index) out.push({ file, index });
  }
  return out;
}

const deployableOf = (ctx: DetectorContext, p: PackageInfo = ctx.pkg) =>
  ctx.facts.find(
    (f) =>
      f.type === 'deployable' &&
      f.subject === ctx.pkgSubject(p) &&
      f.element?.kind.startsWith('dotnet.'),
  );

/** "net8.0" → ".NET 8"; "netstandard2.0" → ".NET Standard 2.0". */
const runtimeName = (tf: string | undefined) =>
  !tf
    ? '.NET'
    : /^net(\d+)\.\d+/.test(tf)
      ? `.NET ${/^net(\d+)/.exec(tf)![1]}`
      : /^netstandard/.test(tf)
        ? `.NET Standard ${tf.slice(11)}`
        : tf;

const dataAccessOf = (p: PackageInfo) =>
  has(p, /^(Microsoft\.EntityFrameworkCore|Npgsql\.EntityFrameworkCore)/)
    ? 'efcore'
    : p.deps.has('Dapper')
      ? 'dapper'
      : p.deps.has('Npgsql')
        ? 'npgsql'
        : undefined;

const WORKER_LIBS: [RegExp, string][] = [
  [/^MassTransit/, 'masstransit'],
  [/^Hangfire/, 'hangfire'],
  [/^Quartz/, 'quartz'],
  [/^NServiceBus/, 'nservicebus'],
];

// --- deployables -----------------------------------------------------------------------

/** `dotnet.deployable`: ASP.NET Core services and worker services. */
const deployable: Detector = {
  id: 'dotnet.deployable',
  appliesTo: isDotnet,
  async run(ctx) {
    const p = ctx.pkg;
    const project = p.dotnet!;
    const files = await indexes(ctx, dotnetFiles(ctx));
    const manifest = at(manifestOf(p), 1, project.sdk);
    const common = {
      ...(project.targetFramework ? { targetFramework: project.targetFramework } : {}),
      language: project.language,
      ...(dataAccessOf(p) ? { dataAccess: dataAccessOf(p)! } : {}),
    };
    const find = (pred: (c: CsIndex['calls'][number]) => boolean) => {
      for (const { file, index } of files) {
        const call = index.calls.find(pred);
        if (call) return at(file, call.line, call.callee);
      }
      return undefined;
    };
    const web =
      project.sdk === 'Microsoft.NET.Sdk.Web' || has(p, /^Microsoft\.AspNetCore\./)
        ? find((c) =>
            /(^|\.)(WebApplication\.Create(Builder|SlimBuilder)?|WebHost\.CreateDefaultBuilder|ConfigureWebHostDefaults)$/.test(
              c.callee,
            ),
          )
        : undefined;
    const functions = project.functions
      ? (find((c) =>
          /FunctionsApplication\.CreateBuilder|ConfigureFunctionsWorkerDefaults/.test(c.callee),
        ) ?? manifest)
      : undefined;
    if (web || functions) {
      const controllers = files.some(({ index }) => index.classes.some((c) => isController(c)));
      const minimal = files.some(({ index }) =>
        index.calls.some((c) => /\.Map(Get|Post|Put|Patch|Delete|Methods)$/.test(c.callee)),
      );
      const framework = functions
        ? 'azure-functions'
        : has(p, /^Grpc\.AspNetCore/)
          ? 'grpc'
          : minimal && !controllers
            ? 'aspnetcore-minimal'
            : 'aspnetcore';
      return [
        {
          type: 'deployable',
          subject: ctx.pkgSubject(p),
          data: { role: 'service', framework, language: project.language },
          evidence: [manifest, (web ?? functions)!],
          confidence: 0.9,
          detector: 'dotnet.deployable',
          element: {
            kind: 'dotnet.service',
            name: packageTitle(p),
            codePaths: [p.dir || '.'],
            tech: `${runtimeName(project.targetFramework)} + ${framework === 'azure-functions' ? 'Azure Functions' : 'ASP.NET Core'}`,
            properties: { framework, ...common },
          },
        },
      ];
    }
    // A worker: the Worker SDK, or a hosted service / consumer in an executable.
    const hosted =
      find((c) =>
        /(^|\.)(AddHostedService|AddHangfireServer|AddConsumer|AddQuartzHostedService)$/.test(
          c.callee,
        ),
      ) ??
      (() => {
        for (const { file, index } of files) {
          const cls = index.classes.find((c) =>
            c.bases.some((b) => /^(BackgroundService|IHostedService|IConsumer<)/.test(b)),
          );
          if (cls) return at(file, cls.line, cls.name);
        }
        return undefined;
      })();
    const executable =
      project.sdk === 'Microsoft.NET.Sdk.Worker' || /exe/i.test(project.outputType ?? '');
    if (!hosted || !executable) return [];
    const jobLib = WORKER_LIBS.find(([re]) => has(p, re))?.[1] ?? 'hosted-service';
    return [
      {
        type: 'deployable',
        subject: ctx.pkgSubject(p),
        data: { role: 'worker', jobLib, language: project.language },
        evidence: [manifest, hosted],
        confidence: 0.85,
        detector: 'dotnet.worker',
        element: {
          kind: 'dotnet.worker',
          name: packageTitle(p),
          codePaths: [p.dir || '.'],
          tech: `${runtimeName(project.targetFramework)} worker${jobLib === 'hosted-service' ? '' : ` + ${title(jobLib)}`}`,
          properties: { jobLib, ...common },
        },
      },
    ];
  },
};

// --- routes ----------------------------------------------------------------------------

const isController = (c: CsClass) =>
  c.attributes.some((a) => a.name === 'ApiController') ||
  c.bases.some((b) => /^(Controller|ControllerBase)$/.test(b));

const HTTP_ATTR = /^Http(Get|Post|Put|Patch|Delete|Head|Options)$/;

const join = (...parts: string[]) =>
  `/${parts
    .map((p) => p.replace(/^~?\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')}`;

const firstArg = (args: string) =>
  /^\s*(?:template\s*:\s*)?"([^"]*)"/.exec(args)?.[1] ?? csNamedString(args, 'Template');

/** `dotnet.routes`: controllers and minimal API files of an ASP.NET Core service. */
const routes: Detector = {
  id: 'dotnet.routes',
  appliesTo: isDotnet,
  async run(ctx) {
    const service = deployableOf(ctx);
    if (!service || service.element?.kind !== 'dotnet.service') return [];
    const out: Fact[] = [];
    const validation = has(ctx.pkg, /^FluentValidation/) ? 'fluentvalidation' : undefined;
    const add = (
      file: string,
      name: string,
      list: { method: string; path: string; line: number }[],
      v?: string,
    ) => {
      if (!list.length) return;
      const routeList = list.map((r) => `${r.method} ${r.path}`);
      out.push({
        type: 'handler',
        subject: `handler:${file}`,
        data: {
          framework: String(service.data.framework),
          file,
          validation: v ?? null,
          routes: routeList,
        },
        evidence: list.slice(0, 5).map((r) => at(file, r.line, `${r.method} ${r.path}`)),
        confidence: 0.85,
        detector: 'dotnet.routes',
        element: {
          kind: 'node.route-handler',
          name,
          parent: service.subject,
          codePaths: [file],
          properties: {
            routes: routeList,
            ...languageProp(ctx.pkg),
            ...(v ? { validation: v } : {}),
          },
        },
      });
    };
    for (const { file, index } of await indexes(ctx, dotnetFiles(ctx))) {
      for (const cls of index.classes.filter(isController)) {
        const base = cls.name.replace(/Controller$/, '');
        const prefix =
          (cls.attributes.find((a) => a.name === 'Route') &&
            firstArg(cls.attributes.find((a) => a.name === 'Route')!.args)) ??
          '';
        const list = cls.methods.flatMap((m) => {
          const route = m.attributes.find((a) => a.name === 'Route');
          return m.attributes
            .filter((a) => HTTP_ATTR.test(a.name))
            .map((a) => {
              const own = firstArg(a.args) ?? (route ? firstArg(route.args) : undefined) ?? '';
              const path = (
                own.startsWith('/') || own.startsWith('~/') ? join(own) : join(prefix, own)
              )
                .replace(/\[controller\]/gi, base)
                .replace(/\[action\]/gi, m.name);
              return { method: HTTP_ATTR.exec(a.name)![1]!.toUpperCase(), path, line: a.line };
            });
        });
        const annotated =
          validation ??
          (cls.attributes.some((a) => a.name === 'ApiController') ? 'data-annotations' : undefined);
        add(file, `${title(base)} controller`, list, annotated);
      }
      // Minimal APIs: app.MapGet("/x"), groups from MapGroup("/prefix").
      const text = (await ctx.engines.read(file)) ?? '';
      const groups = new Map<string, string>();
      for (const m of text.matchAll(/(?:var\s+)?(\w+)\s*=\s*([\w.]+)\.MapGroup\s*\(\s*"([^"]*)"/g))
        groups.set(m[1]!, join(groups.get(m[2]!) ?? '', m[3]!));
      const list = index.calls.flatMap((c) => {
        const m = /^(\w+)\.Map(Get|Post|Put|Patch|Delete)$/.exec(c.callee);
        if (!m || c.first === undefined) return [];
        return [
          {
            method: m[2]!.toUpperCase(),
            path: join(groups.get(m[1]!) ?? '', c.first),
            line: c.line,
          },
        ];
      });
      const stem = posix.basename(file, posix.extname(file));
      add(
        file,
        stem === 'Program' || stem === 'Startup'
          ? `${service.element!.name} routes`
          : `${title(stem)} routes`,
        list,
        validation,
      );
    }
    return out;
  },
};

// --- data ------------------------------------------------------------------------------

const EF_WRITE =
  /^(Add|AddAsync|AddRange|AddRangeAsync|Update|UpdateRange|Remove|RemoveRange|Attach|ExecuteUpdate|ExecuteUpdateAsync|ExecuteDelete|ExecuteDeleteAsync)$/;
const EF_READ =
  /^(Where|First\w*|Single\w*|Last\w*|Any\w*|All\w*|Count\w*|ToList\w*|ToArray\w*|Find\w*|AsNoTracking\w*|AsQueryable|Include|Select\w*|OrderBy\w*|GroupBy|Max\w*|Min\w*|Sum\w*|Take|Skip)$/;
const SQL_TARGET =
  /\b(FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+"?([A-Za-z_]\w*)"?(?:\."?([A-Za-z_]\w*)"?)?/gi;

interface DbContextInfo {
  cls: CsClass;
  file: string;
  pkg: PackageInfo;
  schema?: string;
}

/** `dotnet.data` (repository scope): EF Core contexts, migrations, and data access. */
const data: Detector = {
  id: 'dotnet.data',
  scope: 'repo',
  async run(ctx) {
    const out: Fact[] = [];
    const packages = ctx.packages.filter(isDotnet);
    const perPackage = new Map<PackageInfo, { file: string; index: CsIndex }[]>();
    for (const p of packages) perPackage.set(p, await indexes(ctx, filesOf(ctx, p)));
    const all = [...perPackage.values()].flat();
    const contexts: DbContextInfo[] = [];
    for (const [pkg, list] of perPackage)
      for (const { file, index } of list)
        for (const cls of index.classes.filter((c) =>
          c.bases.some((b) => /^(DbContext|IdentityDbContext)\b/.test(b)),
        )) {
          const schema = index.calls.find(
            (c) => /HasDefaultSchema$/.test(c.callee) && c.offset > cls.start && c.offset < cls.end,
          )?.first;
          contexts.push({ cls, file, pkg, ...(schema ? { schema } : {}) });
        }
    // [Table("name", Schema = "s")] on entity classes, and ToTable("name", "schema").
    const tableAttr = new Map<string, { table: string; schema?: string }>();
    for (const { index } of all)
      for (const cls of index.classes) {
        const a = cls.attributes.find((x) => x.name === 'Table');
        const name = a && /^\s*"([^"]+)"/.exec(a.args)?.[1];
        if (name)
          tableAttr.set(cls.name, {
            table: name,
            ...(csNamedString(a.args, 'Schema')
              ? { schema: csNamedString(a.args, 'Schema')! }
              : {}),
          });
      }
    const postgres =
      packages.some((p) => has(p, /^Npgsql/)) ||
      all.some(({ index }) => index.calls.some((c) => /UseNpgsql$/.test(c.callee)));
    /** DbSet property name → table. */
    const sets = new Map<string, { table: string; schema: string; entity: string }>();
    for (const c of contexts)
      for (const s of c.cls.dbSets) {
        const attr = tableAttr.get(s.entity);
        sets.set(s.name, {
          table: attr?.table ?? s.name,
          schema: attr?.schema ?? c.schema ?? 'public',
          entity: s.entity,
        });
      }

    if (postgres && contexts.length) {
      const first = contexts[0]!;
      out.push(
        await databaseFact(ctx, [at(first.file, first.cls.line, first.cls.name)], 'dotnet.data'),
      );
      const schemas = new Set([...sets.values()].map((s) => s.schema));
      for (const schema of [...schemas].sort())
        out.push(
          schemaFact(schema, [at(first.file, first.cls.line, first.cls.name)], 'dotnet.data'),
        );
      for (const c of contexts)
        for (const s of c.cls.dbSets) {
          const t = sets.get(s.name)!;
          out.push(
            ...tableFacts(
              {
                schema: t.schema,
                table: t.table,
                model: s.entity,
                columns: [],
                primaryKey: [],
                foreignKeys: [],
                indexes: [],
                file: c.file,
                line: s.line,
              },
              'dotnet.data',
              0.85,
            ),
          );
        }
    } else if (contexts.length) {
      // Another database (SQL Server, SQLite …): one store, read and written by the owners.
      const provider = all
        .flatMap(({ index }) => index.calls)
        .find((c) => /\.Use(SqlServer|Sqlite|MySql|Oracle|Cosmos)$/.test(c.callee));
      const product = provider
        ? {
            SqlServer: 'SQL Server',
            Sqlite: 'SQLite',
            MySql: 'MySQL',
            Oracle: 'Oracle',
            Cosmos: 'Azure Cosmos DB',
          }[/\.Use(\w+)$/.exec(provider.callee)![1]!]
        : 'Database';
      const subject = `store:${(product ?? 'database').toLowerCase().replace(/\W+/g, '-')}`;
      const c = contexts[0]!;
      out.push({
        type: 'db-database',
        subject,
        data: { product },
        evidence: [at(c.file, c.cls.line, c.cls.name)],
        confidence: 0.75,
        detector: 'dotnet.data',
        element: {
          kind: 'gen.other-store',
          name: product ?? 'Database',
          properties: { kind: 'other', product: product ?? 'unknown' },
        },
      });
      for (const ctxInfo of contexts)
        for (const owner of deployablesFor(ctx, ctxInfo.pkg))
          out.push({
            type: 'db-database',
            subject: `${owner}->${subject}`,
            data: { deployable: owner },
            evidence: [at(ctxInfo.file, ctxInfo.cls.line, ctxInfo.cls.name)],
            confidence: 0.7,
            detector: 'dotnet.data',
            relation: { type: 'writes', from: owner, to: subject, via: 'efcore' },
          });
    }

    for (const p of packages) {
      const owners = deployablesFor(ctx, p);
      if (!owners.length) continue;
      for (const { file, index } of perPackage.get(p) ?? []) {
        const uses: { target: string; op: 'read' | 'write'; orm: string; line: number }[] = [];
        for (const c of index.calls) {
          const parts = c.callee.split('.');
          const method = parts[parts.length - 1]!;
          const set = parts.slice(0, -1).find((x) => sets.has(x));
          if (set && parts.length >= 3) {
            if (EF_WRITE.test(method))
              uses.push({ target: set, op: 'write', orm: 'efcore', line: c.line });
            else if (EF_READ.test(method))
              uses.push({ target: set, op: 'read', orm: 'efcore', line: c.line });
          }
        }
        const dapper = index.usings.includes('Dapper');
        for (const s of index.strings) {
          if (!/^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(s.value)) continue;
          for (const m of s.value.matchAll(SQL_TARGET))
            uses.push({
              target: m[3] ? `${m[2]}.${m[3]}` : m[2]!,
              op: /^(FROM|JOIN)$/i.test(m[1]!) ? 'read' : 'write',
              orm: dapper ? 'dapper' : 'sql',
              line: s.line,
            });
        }
        for (const u of uses)
          for (const deployable of owners)
            out.push({
              type: 'orm-usage',
              subject: `use:${deployable}:${file}:${u.line}:${u.target}`,
              data: {
                deployable,
                target: sets.get(u.target)?.table ?? u.target,
                op: u.op,
                orm: u.orm,
                file,
              },
              evidence: [at(file, u.line, `${u.target} (${u.op})`)],
              confidence: 0.8,
              detector: 'dotnet.data',
            });
      }
      out.push(...(await migrationsOf(ctx, p, owners)));
    }
    return out;
  },
};

/** EF Core migrations (`migrationBuilder.CreateTable(name: …, schema: …)`) of a package. */
async function migrationsOf(
  ctx: DetectorContext,
  p: PackageInfo,
  owners: string[],
): Promise<Fact[]> {
  const files = ctx.engines.repo.files.filter(
    (f) =>
      (p.dir === '' || f.startsWith(`${p.dir}/`)) &&
      /(^|\/)Migrations\/[^/]+\.cs$/.test(f) &&
      !/\.Designer\.cs$|ModelSnapshot\.cs$/.test(f),
  );
  const self = ctx.pkgSubject(p);
  const deployable = owners.includes(self) ? self : owners.length === 1 ? owners[0] : undefined;
  if (!files.length || !deployable) return [];
  const tables = new Set<string>();
  const schemas = new Set<string>();
  for (const f of files) {
    const index = await ctx.engines.cs(f);
    for (const c of index?.calls ?? []) {
      const name = csNamedString(c.args, 'name') ?? c.first;
      const schema = csNamedString(c.args, 'schema');
      if (/\.(CreateTable|AddColumn|AlterColumn|DropTable|RenameTable)$/.test(c.callee) && name) {
        const table = /\.AddColumn|\.AlterColumn/.test(c.callee)
          ? csNamedString(c.args, 'table')
          : name;
        if (table) tables.add(`${schema ?? 'public'}.${table}`);
      }
      if (/\.EnsureSchema$/.test(c.callee) && name) schemas.add(schemaSubject(name));
      if (schema) schemas.add(schemaSubject(schema));
    }
  }
  return [
    {
      type: 'migrations',
      subject: `migrations:${self}:efcore`,
      data: {
        deployable,
        tool: 'efcore',
        tables: [...tables].sort(),
        schemas: [...schemas].sort(),
      },
      evidence: files.slice(0, 5).map((f) => at(f, 1)),
      confidence: 0.9,
      detector: 'dotnet.data',
    },
  ];
}

// --- messaging -------------------------------------------------------------------------

const TRANSPORTS: [RegExp, string][] = [
  [/UsingRabbitMq$/, 'RabbitMQ'],
  [/UsingAzureServiceBus$/, 'Azure Service Bus'],
  [/UsingAmazonSqs$/, 'Amazon SQS'],
  [/UsingKafka$|AddRider$/, 'Kafka'],
];

/** `dotnet.messaging` (repository scope): MassTransit transports, consumers and publishers; Hangfire. */
const messaging: Detector = {
  id: 'dotnet.messaging',
  scope: 'repo',
  async run(ctx) {
    const out: Fact[] = [];
    const services = backendServices(ctx);
    for (const p of ctx.packages.filter(isDotnet)) {
      const owners = deployablesFor(ctx, p).filter((o) => services.some((s) => s.subject === o));
      if (!owners.length) continue;
      const files = await indexes(ctx, filesOf(ctx, p));
      const brokers: { subject: string; product: string; evidence: Evidence }[] = [];
      let consumes: Evidence | undefined;
      let publishes: Evidence | undefined;
      for (const { file, index } of files) {
        for (const c of index.calls) {
          const t = TRANSPORTS.find(([re]) => re.test(c.callee));
          if (t && !brokers.some((b) => b.product === t[1]))
            brokers.push({
              subject: `broker:${t[1].toLowerCase().replace(/\W+/g, '-')}`,
              product: t[1],
              evidence: at(file, c.line, c.callee),
            });
          if (/^BackgroundJob\.(Enqueue|Schedule)$|^RecurringJob\.AddOrUpdate$/.test(c.callee)) {
            if (!brokers.some((b) => b.product === 'Hangfire'))
              brokers.push({
                subject: 'broker:hangfire',
                product: 'Hangfire',
                evidence: at(file, c.line, c.callee),
              });
            publishes ??= at(file, c.line, c.callee);
          }
          if (/(^|\.)AddHangfireServer$/.test(c.callee)) {
            if (!brokers.some((b) => b.product === 'Hangfire'))
              brokers.push({
                subject: 'broker:hangfire',
                product: 'Hangfire',
                evidence: at(file, c.line, c.callee),
              });
            consumes ??= at(file, c.line, c.callee);
          }
          if (/\.(Publish|Send)$/.test(c.callee) && index.usings.includes('MassTransit'))
            publishes ??= at(file, c.line, c.callee);
        }
        const consumer = index.classes.find((c) => c.bases.some((b) => /^IConsumer</.test(b)));
        if (consumer) consumes ??= at(file, consumer.line, consumer.name);
      }
      for (const b of brokers) {
        out.push({
          type: 'job-queue',
          subject: b.subject,
          data: { product: b.product },
          evidence: [b.evidence],
          confidence: 0.8,
          detector: 'dotnet.messaging',
          element: {
            kind: 'gen.other-broker',
            name: b.product,
            properties: { product: b.product },
          },
        });
        for (const owner of owners) {
          if (consumes)
            out.push({
              type: 'job-consumer',
              subject: `consumer:${owner}:${b.subject}`,
              data: {},
              evidence: [consumes],
              confidence: 0.8,
              detector: 'dotnet.messaging',
              relation: { type: 'consumes', from: owner, to: b.subject },
            });
          if (publishes)
            out.push({
              type: 'job-producer',
              subject: `producer:${owner}:${b.subject}`,
              data: {},
              evidence: [publishes],
              confidence: 0.8,
              detector: 'dotnet.messaging',
              relation: { type: 'publishes', from: owner, to: b.subject },
            });
        }
      }
    }
    return out;
  },
};

// --- HTTP calls, third-party APIs and auth --------------------------------------------

/** `dotnet.http-calls` (repository scope): HttpClient base addresses from configuration. */
const httpCalls: Detector = {
  id: 'dotnet.http-calls',
  scope: 'repo',
  async run(ctx) {
    const services = backendServices(ctx);
    const callers = services.filter((s) => s.element?.kind.startsWith('dotnet.'));
    if (services.length < 2 || !callers.length) return [];
    const resolve = await serviceResolver(ctx, services);
    const out: Fact[] = [];
    for (const from of callers) {
      const p = ctx.packages.find((x) => ctx.pkgSubject(x) === from.subject);
      if (!p) continue;
      for (const { file, index } of await indexes(ctx, filesOf(ctx, p))) {
        if (
          !index.calls.some((c) =>
            /(AddHttpClient|AddRefitClient|HttpClient|RestClient)$/.test(c.callee),
          )
        )
          continue;
        for (const k of index.config.filter((x) => x.kind !== 'connection-string')) {
          const to = resolve(k.key);
          if (!to || to === from.subject) continue;
          out.push({
            type: 'http-call',
            subject: `call:${from.subject}->${to}`,
            data: { from: from.subject, to, env: k.key },
            evidence: [at(file, k.line, k.key)],
            confidence: 0.75,
            detector: 'dotnet.http-calls',
            relation: { type: 'calls', from: from.subject, to, protocol: 'http' },
          });
        }
      }
    }
    return out;
  },
};

const SDKS: [RegExp, string][] = [
  [/^Stripe\.net$/, 'Stripe'],
  [/^SendGrid$/, 'SendGrid'],
  [/^AWSSDK\./, 'AWS'],
  [/^Twilio$/, 'Twilio'],
  [/^OpenAI$|^Azure\.AI\.OpenAI$/, 'OpenAI API'],
  [/^Anthropic(\.SDK)?$/, 'Anthropic API'],
  [/^Postmark$/, 'Postmark'],
  [/^Sentry(\.AspNetCore)?$/, 'Sentry'],
  [/^Azure\.Storage\./, 'Azure Storage'],
];

/** `dotnet.external-sdk`: third-party APIs, from the NuGet packages of a project. */
const externalSdk: Detector = {
  id: 'dotnet.external-sdk',
  appliesTo: (p) => isDotnet(p) && SDKS.some(([re]) => has(p, re)),
  async run(ctx) {
    const owners = deployablesFor(ctx, ctx.pkg);
    const out: Fact[] = [];
    for (const dep of [...ctx.pkg.deps].sort()) {
      const sdk = SDKS.find(([re]) => re.test(dep));
      if (!sdk) continue;
      const evidence = [await depEvidence(ctx, ctx.pkg, dep)];
      const subject = `ext:${sdk[1]}`;
      out.push({
        type: 'external-sdk',
        subject,
        data: { sdk: dep },
        evidence,
        confidence: 0.8,
        detector: 'dotnet.external-sdk',
        element: { kind: 'gen.external', name: sdk[1] },
      });
      for (const owner of owners)
        out.push({
          type: 'external-sdk',
          subject: `${owner}->${subject}`,
          data: { sdk: dep },
          evidence,
          confidence: 0.8,
          detector: 'dotnet.external-sdk',
          relation: { type: 'calls', from: owner, to: subject, protocol: 'https' },
        });
    }
    return out;
  },
};

const AUTH: { dep: RegExp; method: 'jwt' | 'session'; provider?: string }[] = [
  { dep: /^Microsoft\.AspNetCore\.Authentication\.JwtBearer$/, method: 'jwt' },
  {
    dep: /^Microsoft\.AspNetCore\.Authentication\.Cookies$|^Microsoft\.AspNetCore\.Identity/,
    method: 'session',
  },
  { dep: /^Microsoft\.Identity\.Web$/, method: 'jwt', provider: 'Microsoft Entra ID' },
  { dep: /^Auth0\.AspNetCore\.Authentication$/, method: 'jwt', provider: 'Auth0' },
];

/** `dotnet.auth`: authentication of an ASP.NET Core service, and its identity provider. */
const auth: Detector = {
  id: 'dotnet.auth',
  appliesTo: (p) => isDotnet(p) && AUTH.some((a) => has(p, a.dep)),
  async run(ctx) {
    const service = deployableOf(ctx);
    if (!service || service.element?.kind !== 'dotnet.service') return [];
    const found = AUTH.flatMap((a) => {
      const dep = [...ctx.pkg.deps].find((d) => a.dep.test(d));
      return dep ? [{ ...a, name: dep }] : [];
    });
    const evidence = await Promise.all(found.map((a) => depEvidence(ctx, ctx.pkg, a.name)));
    const out: Fact[] = [
      {
        type: 'middleware',
        subject: `mw:${service.subject}:auth`,
        data: { kind: 'auth', libs: found.map((a) => a.name) },
        evidence,
        confidence: 0.8,
        detector: 'dotnet.auth',
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
      const ev = [await depEvidence(ctx, ctx.pkg, a.name)];
      out.push(
        {
          type: 'external-sdk',
          subject,
          data: { provider: a.provider },
          evidence: ev,
          confidence: 0.8,
          detector: 'dotnet.auth',
          element: { kind: 'gen.auth-provider', name: a.provider! },
        },
        {
          type: 'external-sdk',
          subject: `${service.subject}->${subject}`,
          data: {},
          evidence: ev,
          confidence: 0.8,
          detector: 'dotnet.auth',
          relation: { type: 'authenticates-with', from: service.subject, to: subject },
        },
      );
    }
    return out;
  },
};

export const DOTNET_DEPLOYABLE_DETECTORS: Detector[] = [deployable];
export const DOTNET_DETECTORS: Detector[] = [routes, auth, externalSdk, data, messaging, httpCalls];
