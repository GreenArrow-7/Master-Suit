import type { ReactNode } from 'react';

/**
 * The list-screen header: the page title, a line saying how large the record
 * set is, and a right-aligned action cluster. It exists so that pattern is one
 * component rather than twenty inline-styled copies that drift apart.
 */
export default function ListHeader({
  title,
  count,
  total,
  noun = 'record',
  capped,
  actions,
  secondaryActions,
  description: override,
  eyebrow,
}: {
  title: ReactNode;
  /** Rows on screen. Omit for screens that are not a record list. */
  count?: number;
  /** The whole scope, from a count query. Beats `count`: a page size is not information. */
  total?: number;
  /** Singular noun for the count line. Pluralised with a trailing s. */
  noun?: string;
  /** True when the query hit its take() limit, so the count is a page not a total. */
  capped?: boolean;
  /** Replaces the generated count line where a screen has something better to say. */
  description?: ReactNode;
  /** Off by default — the reference screen carries no eyebrow above its title. */
  eyebrow?: string;
  /** The primary action, and anything that must always be visible. */
  actions?: ReactNode;
  /**
   * Actions that fold behind a ⋯ disclosure.
   *
   * A phone header carrying Import, Export, Columns and Add lead is four
   * buttons competing above the content they act on, and only one of them is
   * what a person came to do. Passing the other three here keeps them one tap
   * away instead of in the way. Optional, so screens adopt it when they have a
   * genuine primary action rather than by rote.
   */
  secondaryActions?: ReactNode;
}) {
  const plural = (n: number) => `${noun}${n === 1 ? '' : 's'}`;
  const description =
    override ??
    (total !== undefined
      ? `${total.toLocaleString('en-GB')} ${plural(total)} in your scope`
      : count === undefined
        ? undefined
        : capped
          ? `First ${count} ${noun}s in your scope`
          : `${count} ${plural(count)} in your scope`);

  return (
    <header className="lf-list-header">
      <div className="lf-list-header__copy">
        {eyebrow && <div className="lf-eyebrow">{eyebrow}</div>}
        <h1 className="lf-list-header__title">{title}</h1>
        {description && <p className="lf-list-header__count">{description}</p>}
      </div>
      {(actions || secondaryActions) && (
        <div className="lf-list-header__actions">
          {secondaryActions && (
            /* Native disclosure: no state to synchronise and keyboard
               reachable. It does NOT close itself — no browser dismisses a
               <details> on outside click — so the top bar installs one
               delegated listener that closes these on outside click, Escape
               and item selection. */
            <details className="lf-overflow">
              <summary className="lf-btn lf-btn--secondary" aria-label="More actions" title="More actions">
                <span aria-hidden="true">⋯</span>
              </summary>
              <div className="lf-overflow__menu">{secondaryActions}</div>
            </details>
          )}
          {actions}
        </div>
      )}
    </header>
  );
}
