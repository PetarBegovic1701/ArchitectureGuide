import { hrefFor } from '../hooks';
import { ConcurrencyLab } from '../panels/ConcurrencyLab';
import { LearnShell } from './Learn';

/** The concurrency lab as a page (Implementation.md §17.7). */
export function LabPage() {
  return (
    <LearnShell current="lab">
      <h1 className="text-2xl font-bold">Concurrency lab</h1>
      <ConcurrencyLab />
      <p className="text-sm text-[var(--ag-muted)]">
        Read more:{' '}
        <a
          className="text-[var(--ag-accent)] hover:underline"
          href={hrefFor({ page: 'doc', id: 'topic.concurrency-control' })}
        >
          Concurrency control
        </a>
        ,{' '}
        <a
          className="text-[var(--ag-accent)] hover:underline"
          href={hrefFor({ page: 'doc', id: 'topic.transactions-and-isolation' })}
        >
          Transactions and isolation
        </a>
        . In the editor, select a <em>writes</em> arrow and choose “Try it in the concurrency lab”
        to replay it with that arrow’s setting.
      </p>
    </LearnShell>
  );
}
