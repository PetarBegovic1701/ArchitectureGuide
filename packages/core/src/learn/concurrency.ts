/**
 * The concurrency lab (Implementation.md §17.7): requests that each buy one item run at the
 * same time against one stock row. The simulation shows the interleaving per
 * `concurrencyControl`: a lost update without control, a retry with a version check or
 * SERIALIZABLE, waiting with a lock. Pure and deterministic, so it can be tested.
 */

export type LabControl =
  'none' | 'optimistic-version' | 'row-lock' | 'advisory-lock' | 'serializable-retry';

export const LAB_CONTROLS: { id: LabControl; name: string; sql: string }[] = [
  { id: 'none', name: 'No control', sql: 'SELECT stock …; UPDATE … SET stock = $new' },
  {
    id: 'optimistic-version',
    name: 'Optimistic (version column)',
    sql: 'UPDATE … SET stock = $new, version = version + 1 WHERE id = $id AND version = $read',
  },
  { id: 'row-lock', name: 'Row lock', sql: 'SELECT stock … FOR UPDATE' },
  { id: 'advisory-lock', name: 'Advisory lock', sql: 'SELECT pg_advisory_xact_lock($productId)' },
  {
    id: 'serializable-retry',
    name: 'SERIALIZABLE with retry',
    sql: 'BEGIN ISOLATION LEVEL SERIALIZABLE; … retry on SQLSTATE 40001',
  },
];

export type LabStepKind =
  'begin' | 'lock' | 'wait' | 'read' | 'compute' | 'write' | 'conflict' | 'commit' | 'rollback';

export interface LabStep {
  /** Index of the request (lane). */
  lane: number;
  /** Time slot where the step starts. */
  t: number;
  /** Slots it takes; waits are longer than one. */
  duration: number;
  kind: LabStepKind;
  /** Short text for the card, e.g. "SELECT stock → 5". */
  label: string;
  /** The stock in the database after this step. */
  stock: number;
}

export interface LabRun {
  control: LabControl;
  lanes: string[];
  steps: LabStep[];
  /** Number of time slots. */
  length: number;
  initial: number;
  final: number;
  expected: number;
  /** Sales that the final stock does not reflect. */
  lostUpdates: number;
  retries: number;
  /** Slots spent waiting for a lock, summed over requests. */
  waited: number;
  summary: string;
}

const LANE_NAMES = ['Request A', 'Request B', 'Request C', 'Request D'];

export function simulateConcurrency(
  control: LabControl,
  options: { requests?: number; initial?: number } = {},
): LabRun {
  const requests = Math.min(Math.max(options.requests ?? 2, 2), LANE_NAMES.length);
  const initial = options.initial ?? 5;
  const steps: LabStep[] = [];
  let stock = initial;
  let version = 1;
  let retries = 0;
  let waited = 0;
  const add = (lane: number, t: number, kind: LabStepKind, label: string, duration = 1) =>
    steps.push({ lane, t, duration, kind, label, stock });

  const begin = control === 'serializable-retry' ? 'BEGIN SERIALIZABLE' : 'BEGIN';
  for (let lane = 0; lane < requests; lane++) add(lane, 0, 'begin', begin);

  if (control === 'row-lock' || control === 'advisory-lock') {
    // One request at a time holds the lock; the others wait for it, then read fresh data.
    for (let lane = 0; lane < requests; lane++) {
      const start = 1 + lane * 4;
      if (lane > 0) {
        add(lane, 1, 'wait', `Waits for ${LANE_NAMES[lane - 1]}'s lock`, start - 1);
        waited += start - 1;
      }
      const seen = stock;
      if (control === 'row-lock') {
        add(lane, start, 'lock', `SELECT … FOR UPDATE → ${seen}`);
        add(lane, start + 1, 'compute', `${seen} − 1 = ${seen - 1}`);
      } else {
        add(lane, start, 'lock', 'pg_advisory_xact_lock(product)');
        add(lane, start + 1, 'read', `SELECT stock → ${seen}`);
      }
      stock = seen - 1;
      add(lane, start + 2, 'write', `UPDATE stock = ${stock}`);
      add(lane, start + 3, 'commit', 'COMMIT (lock released)');
    }
  } else {
    // Rounds: every pending request reads at the same time (the worst case), then they
    // write one after the other. Without control, every write wins with a stale value.
    let pending = [...Array(requests).keys()];
    let t = 1;
    while (pending.length > 0) {
      const seen = stock;
      const seenVersion = version;
      for (const lane of pending) {
        add(
          lane,
          t,
          'read',
          control === 'optimistic-version'
            ? `SELECT → ${seen} (v${seenVersion})`
            : `SELECT stock → ${seen}`,
        );
        add(lane, t + 1, 'compute', `${seen} − 1 = ${seen - 1}`);
      }
      const retry: number[] = [];
      pending.forEach((lane, k) => {
        const at = t + 2 + k;
        const first = k === 0;
        if (control === 'none') {
          stock = seen - 1;
          add(lane, at, 'write', `UPDATE stock = ${seen - 1}`);
          add(lane, at + 1, 'commit', 'COMMIT');
        } else if (control === 'optimistic-version') {
          if (first) {
            stock = seen - 1;
            version += 1;
            add(lane, at, 'write', `UPDATE … WHERE version = ${seenVersion} → 1 row`);
            add(lane, at + 1, 'commit', 'COMMIT');
          } else {
            add(lane, at, 'conflict', `UPDATE … WHERE version = ${seenVersion} → 0 rows`);
            add(lane, at + 1, 'rollback', 'Retry with fresh data');
            retry.push(lane);
          }
        } else {
          // SERIALIZABLE: the conflict shows at COMMIT, with SQLSTATE 40001.
          add(lane, at, 'write', `UPDATE stock = ${seen - 1}`);
          if (first) {
            stock = seen - 1;
            add(lane, at + 1, 'commit', 'COMMIT');
          } else {
            add(lane, at + 1, 'conflict', 'COMMIT → 40001 serialization failure');
            add(lane, at + 2, 'rollback', 'ROLLBACK, retry');
            retry.push(lane);
          }
        }
      });
      retries += retry.length;
      t += 3 + pending.length + (control === 'serializable-retry' ? 1 : 0);
      pending = retry;
    }
  }

  const length = Math.max(...steps.map((s) => s.t + s.duration));
  const expected = initial - requests;
  const lostUpdates = stock - expected;
  return {
    control,
    lanes: LANE_NAMES.slice(0, requests),
    steps: steps.sort((a, b) => a.t - b.t || a.lane - b.lane),
    length,
    initial,
    final: stock,
    expected,
    lostUpdates,
    retries,
    waited,
    summary: summarize(control, { requests, initial, final: stock, lostUpdates, retries }),
  };
}

function summarize(
  control: LabControl,
  r: { requests: number; initial: number; final: number; lostUpdates: number; retries: number },
): string {
  const sold = `${r.requests} items were sold`;
  switch (control) {
    case 'none':
      return `Lost update: every request read ${r.initial} and wrote ${r.initial - 1}. ${sold}, but the stock only went down by ${r.initial - r.final}. ${r.lostUpdates} sale${r.lostUpdates === 1 ? ' is' : 's are'} lost, and the shop can oversell.`;
    case 'optimistic-version':
      return `Correct: the version check found that someone else had written first (0 rows changed), so ${r.retries === 1 ? 'that request' : 'those requests'} read again and retried (${r.retries} ${r.retries === 1 ? 'retry' : 'retries'}). No waiting; good when conflicts are rare.`;
    case 'row-lock':
      return `Correct: each request waits for the row lock, then reads the new value. Simple and safe, but requests queue up on a busy row.`;
    case 'advisory-lock':
      return `Correct: the advisory lock lets one request at a time work on this product, even across several rows or tables. Every writer must take the same lock.`;
    case 'serializable-retry':
      return `Correct: PostgreSQL stopped the later transaction at COMMIT with a serialization failure (SQLSTATE 40001), and the app retried it (${r.retries} ${r.retries === 1 ? 'retry' : 'retries'}). Safe for any logic, as long as every write path retries.`;
  }
}
