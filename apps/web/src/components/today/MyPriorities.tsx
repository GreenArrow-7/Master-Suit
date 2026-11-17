/**
 * "My priorities": the ranked list, and the brief for the first one.
 *
 * Presentational and server-rendered. It writes nothing: every action is a link
 * to the screen that already does the job properly — with its own permission
 * check, its own confirmation, and its own place in the offline outbox. A
 * dashboard that posted a write of its own would be a fourth call-logging path
 * to keep correct, and the one most likely to be tapped by accident.
 *
 * So nothing here can send a message, create a commitment with a customer or
 * change a record. "Call" is a link to the lead, where the number is
 * serialised through field security and the `tel:` link is built by
 * `dialable()`; "Log call" opens the existing form, which asks before it
 * writes.
 */
import Link from 'next/link';
import type { TodayItem } from '@/services/today/priorities';
import type { Brief } from '@/services/today/brief';

const TONE: Record<TodayItem['kind'], 'vermillion' | 'brass' | 'slate'> = {
  sla: 'vermillion',
  overdue: 'vermillion',
  callback: 'brass',
  untouched: 'brass',
  idle: 'slate',
};

export default function MyPriorities({
  items,
  brief,
  slug,
  listHref,
}: {
  items: TodayItem[];
  brief: Brief | null;
  slug: string;
  listHref: string;
}) {
  /**
   * An empty list is a real state and a good one.
   *
   * Not a skeleton, not "no data": a person who has cleared their queue should
   * be told so in one line, and the way to the full lists stays visible because
   * "nothing needs me" is exactly when somebody goes looking for more work.
   */
  if (items.length === 0) {
    return (
      <section className="lf-card" aria-label="My priorities">
        <h2 style={{ margin: 0, fontSize: 'var(--lf-text-md)' }}>My priorities</h2>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-3)' }}>
          Nothing needs you right now.{' '}
          <Link className="lf-link" href={listHref}>
            Open my leads →
          </Link>
        </p>
      </section>
    );
  }

  const [first] = items;

  return (
    <section className="lf-card" aria-label="My priorities">
      <div
        style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
      >
        <h2 style={{ margin: 0, fontSize: 'var(--lf-text-md)' }}>My priorities</h2>
        <Link className="lf-link" href={listHref}>
          All my leads →
        </Link>
      </div>

      {/**
       * Why this list and the queue counts below it can disagree.
       *
       * They answer different questions and both answers are right. The chips
       * count every open follow-up that qualifies, which is what a queue is
       * for; this list leaves out work nobody should act on — a follow-up
       * whose lead sits in a stage the workspace marked terminal, say. A
       * reader who sees "1 overdue" above an empty overdue band deserves the
       * sentence rather than the puzzle.
       */}
      <p style={{ margin: '2px 0 0', fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
        What to act on now. The queues below count every open follow-up, including those on leads nobody is working.
      </p>

      <ol className="lf-today" style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
        {items.map((item, index) => (
          <li key={`${item.kind}-${item.leadId}`} className="lf-today__row" data-tone={TONE[item.kind]}>
            <span className="lf-today__n" aria-hidden="true">
              {index + 1}
            </span>
            <span className="lf-today__who">
              <Link className="lf-link" href={`/${slug}/sales/leads/${item.leadId}`}>
                {item.title}
              </Link>
            </span>
            {/* The reason is the product. Never truncated away on a phone. */}
            <span className="lf-today__why">{item.reason}</span>
            <Link
              className="lf-btn lf-btn--secondary lf-btn--sm lf-today__do"
              href={`/${slug}/sales/leads/${item.leadId}`}
            >
              {item.action}
            </Link>
          </li>
        ))}
      </ol>

      {/* The brief, for the one they will open first. Not for all seven: seven
          briefs is a reading task, and the point is to start the first call. */}
      {first && brief && brief.lines.length > 0 && (
        <div className="lf-today__brief">
          <p style={{ margin: 0, fontWeight: 600 }}>Before you call {first.title}</p>
          <ul style={{ margin: '4px 0 0', paddingInlineStart: '1.1em' }}>
            {brief.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {brief.questions.length > 0 && (
            <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-3)' }}>Ask: {brief.questions.join(' · ')}</p>
          )}
        </div>
      )}
    </section>
  );
}
