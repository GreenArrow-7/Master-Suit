import SalesLink from './SalesLink';
import type { Scope } from '@/lib/security/rbac';

/** A work list's wider view, by the scope it covers. OWN has none: its own work is all it sees. */
const WIDER: Partial<Record<Scope, readonly [label: string, where: string]>> = {
  TEAM: ['Team', 'in your team'],
  BRANCH: ['Branch', 'in your branch'],
  REGION: ['Region', 'in your region'],
  ORGANIZATION: ['Everyone', 'in the workspace'],
};

/**
 * Whose work a list of follow-ups or tasks shows: by default everyone the
 * viewer's scope covers, or their own with `?view=mine`. `mine` is also true at
 * OWN, where both are the same rows and no switch is offered. A function rather
 * than a component, so the page renders `tabs` inline.
 */
export function whoseWork(scope: Scope, view: string | undefined) {
  const wider = WIDER[scope];
  const mine = !wider || view === 'mine';
  return {
    mine,
    /** "3 follow-ups in your team", "First 100 tasks of yours". */
    count: (rows: number, capped: boolean, noun: string) =>
      `${capped ? 'First ' : ''}${rows} ${noun}${rows === 1 ? '' : 's'} ${mine ? 'of yours' : wider?.[1]}`,
    /** Mine and the wider view, or nothing at OWN; `href(mine)` keeps the list's own filters. */
    tabs: (href: (mine: boolean) => string) =>
      wider && (
        <nav className="lf-tabs" aria-label="Whose work" style={{ marginBottom: 'var(--lf-space-3)' }}>
          {(
            [
              ['Mine', true],
              [wider[0], false],
            ] as const
          ).map(([label, isMine]) => (
            <SalesLink key={label} className="lf-tab" role="tab" aria-selected={mine === isMine} href={href(isMine)}>
              {label}
            </SalesLink>
          ))}
        </nav>
      ),
  };
}
