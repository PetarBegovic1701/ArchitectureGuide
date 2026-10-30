import type { Fact } from '@archguide/core';
import type { Detector, DetectorContext } from '../context';
import { at } from '../context';
import type { PackageInfo } from '../discover';
import { manifestOf } from '../discover';
import { normalizePy } from '../engines/manifests';
import { depEvidence, languageProp, packageTitle } from './util';

/** .NET test projects: not deployed and not a library of the application. */
const TEST_PACKAGES = ['Microsoft.NET.Test.Sdk', 'xunit', 'NUnit', 'MSTest.TestFramework'];
export const isTestProject = (p: PackageInfo) =>
  p.language === 'dotnet' && TEST_PACKAGES.some((d) => p.deps.has(d));

/** Whether `q` depends on the package `p` (npm name, Python distribution, .NET project). */
const dependsOn = (q: PackageInfo, p: PackageInfo) =>
  q !== p &&
  (q.deps.has(p.name) ||
    (p.language === 'python' && [...q.deps].some((d) => normalizePy(d) === p.name)));

/**
 * Kind of a library that belongs to one deployable, from the last part of its name: the
 * projects of a clean or onion architecture ("Orders.Domain", "Orders.Application").
 */
function layerKind(p: PackageInfo): string {
  const last = p.name
    .split(/[.\-_]/)
    .pop()!
    .toLowerCase();
  if (last === 'domain') return 'node.domain';
  if (last === 'application' || last === 'usecases') return 'node.use-case';
  return 'node.module';
}

/**
 * `lang.libs` (repository scope): local Python packages and .NET class libraries that
 * deployables use. A library that only one deployable uses (directly or through other
 * libraries) is a module of that deployable; one that several use is a shared package.
 * Project references and local path dependencies become `depends-on` relations.
 */
const libraries: Detector = {
  id: 'lang.libs',
  scope: 'repo',
  async run(ctx: DetectorContext) {
    const deployables = new Set(
      ctx.facts.filter((f) => f.type === 'deployable').map((f) => f.subject),
    );
    const subject = (p: PackageInfo) => ctx.pkgSubject(p);
    const packages = ctx.packages.filter(
      (p) => (p.language === 'python' || p.language === 'dotnet') && !isTestProject(p),
    );
    const libs = packages.filter((p) => !deployables.has(subject(p)));
    // Which deployables reach each library through dependencies.
    const users = new Map<PackageInfo, Set<string>>();
    for (const d of packages.filter((p) => deployables.has(subject(p)))) {
      const seen = new Set<PackageInfo>();
      const queue = [d];
      while (queue.length) {
        const q = queue.shift()!;
        for (const lib of libs)
          if (!seen.has(lib) && dependsOn(q, lib)) {
            seen.add(lib);
            queue.push(lib);
            users.set(lib, (users.get(lib) ?? new Set()).add(subject(d)));
          }
      }
    }
    const out: Fact[] = [];
    const used = libs.filter((l) => users.get(l)?.size);
    for (const lib of used) {
      const owners = [...users.get(lib)!].sort();
      const single = owners.length === 1;
      out.push({
        type: 'package',
        subject: subject(lib),
        data: { role: single ? 'module' : 'library', users: owners },
        evidence: [at(manifestOf(lib), 1)],
        confidence: 0.8,
        detector: 'lang.libs',
        element: {
          kind: single ? layerKind(lib) : 'node.shared-lib',
          name: packageTitle(lib),
          ...(single ? { parent: owners[0] } : {}),
          codePaths: [lib.dir || '.'],
          properties: { ...(single ? {} : { package: lib.name }), ...languageProp(lib) },
        },
      });
    }
    const withElement = new Set([...used, ...packages.filter((p) => deployables.has(subject(p)))]);
    for (const q of withElement)
      for (const lib of used)
        if (dependsOn(q, lib))
          out.push({
            type: 'import',
            subject: `${subject(q)}->${subject(lib)}`,
            data: { from: subject(q), to: subject(lib) },
            evidence: [await depEvidence(ctx, q, lib.name)],
            confidence: 0.85,
            detector: 'lang.libs',
            relation: { type: 'depends-on', from: subject(q), to: subject(lib) },
          });
    return out;
  },
};

export const LIBRARY_DETECTORS: Detector[] = [libraries];
