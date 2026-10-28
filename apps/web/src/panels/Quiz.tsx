import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { answerQuiz } from '@archguide/core';
import type { LearningDoc } from '@archguide/core';
import { useProgress } from '../store/progress';

/** The questions at the end of a text (§17.4). Answers are kept in the learner's progress. */
export function Quiz({ doc }: { doc: LearningDoc }) {
  if (!doc.quiz?.length) return null;
  return (
    <section className="space-y-3" aria-label="Quiz" data-testid={`quiz-${doc.id}`}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--ag-muted)]">
        Check yourself
      </h4>
      {doc.quiz.map((q, i) => (
        <Question key={i} doc={doc} index={i} />
      ))}
    </section>
  );
}

function Question({ doc, index }: { doc: LearningDoc; index: number }) {
  const q = doc.quiz![index]!;
  const saved = useProgress((s) => s.progress.quiz[`${doc.id}#${index}`]);
  const [choice, setChoice] = useState<number | undefined>(saved?.answer);
  const [shown, setShown] = useState(!!saved);
  const correct = choice === q.answer;
  const name = `quiz-${doc.id}-${index}`;
  return (
    <fieldset className="space-y-1 rounded border border-[var(--ag-border)] p-2 text-sm">
      <legend className="px-1 font-medium">{q.question}</legend>
      {q.options.map((option, i) => (
        <label
          key={i}
          className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-[var(--ag-panel-2)]"
        >
          <input
            type="radio"
            name={name}
            className="mt-1"
            checked={choice === i}
            onChange={() => {
              setChoice(i);
              setShown(false);
            }}
          />
          <span>
            {option}
            {shown && i === q.answer && (
              <Check
                size={14}
                className="ml-1 inline text-[var(--ag-valid)]"
                aria-label="correct answer"
              />
            )}
          </span>
        </label>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={choice === undefined}
          className="ag-touch rounded bg-[var(--ag-accent)] px-2 py-0.5 text-xs text-[var(--ag-accent-text)] disabled:opacity-40"
          onClick={() => {
            if (choice === undefined) return;
            setShown(true);
            useProgress
              .getState()
              .update((p) =>
                answerQuiz(p, doc.id, index, choice, choice === q.answer, new Date().toISOString()),
              );
          }}
        >
          Check
        </button>
        {shown && (
          <span
            role="status"
            className={`flex items-center gap-1 text-xs font-semibold ${correct ? 'text-[var(--ag-valid)]' : 'text-[var(--ag-error)]'}`}
          >
            {correct ? <Check size={12} aria-hidden /> : <X size={12} aria-hidden />}
            {correct ? 'Correct' : 'Not quite'}
          </span>
        )}
      </div>
      {shown && <p className="text-xs text-[var(--ag-muted)]">{q.explanation}</p>}
    </fieldset>
  );
}
