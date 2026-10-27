import { SCHEMA_VERSION } from '../schema';

/** One function per version step: `steps[n]` upgrades a version-n file to version n + 1. */
const steps: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

export class MigrationError extends Error {}

/** Upgrades a raw project object to the current schema version. Does not validate. */
export function migrate(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MigrationError('A project file must contain a JSON object');
  }
  let current = raw as Record<string, unknown>;
  let version = current.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new MigrationError('The project file has no valid "schemaVersion"');
  }
  if (version > SCHEMA_VERSION) {
    throw new MigrationError(
      `The project uses schema version ${version}; this build supports up to ${SCHEMA_VERSION}. Update ArchitectureGuide.`,
    );
  }
  while (version < SCHEMA_VERSION) {
    const step = steps[version];
    if (!step) throw new MigrationError(`No migration from schema version ${version}`);
    current = { ...step(current), schemaVersion: version + 1 };
    version += 1;
  }
  return current;
}
