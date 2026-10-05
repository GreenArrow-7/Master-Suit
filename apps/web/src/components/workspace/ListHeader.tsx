import type { ReactNode } from 'react';

/**
 * The list-screen header, reproducing what the Leads screen established: a 30px
 * title, a line saying how much of the record set is on screen, and a right-aligned
 * action cluster. It exists so that pattern is one component rather than twenty
 * inline-styled copies that drift apart.
 */
export default function ListHeader({
  title,
  count,
  noun = 'record',
  capped,
  actions,
  secondaryActions,
  description: override,
  help,
}: {
  title: ReactNode;
  /** Rows on screen. Omit for screens that are not a record list. */
  count?: number;
  /** Singular noun for the count line. Pluralised with a trailing s. */
  noun?: string;
  /** True when the query hit its take() limit, so the count is a page not a total. */
  capped?: boolean;
  /** Replaces the generated count line where a screen has something better to say. */
  description?: ReactNode;
  /**
   * The long explanation, folded into a native <details>: there when wanted, out
   * of the way when not. Decision-point warnings (consent, approval rules,
   * destructive actions) do not belong here — keep those next to their control.
   */
  help?: ReactNode;
  /** The primary action, and anything that must always be visible. */
  actions?: ReactNode;
  /**
   * Actions that fold behind a ••• disclosure.
   *
   * A phone header carrying Import, Export, Columns and Add lead is four
   * buttons competing above the content they act on, and only one of them is
   * what a person came to do. Passing the other three here keeps them one tap
   * away instead of in the way. Optional, so screens adopt it when they have a
   * genuine primary action rather than by rote.
   */
  secondaryActions?: ReactNode;
}) {
  const description =
    override ??
    (count === undefined
      ? undefined
      : capped
        ? `First ${count} ${noun}s in your scope`
        : `${count} ${noun}${count === 1 ? '' : 's'} in your scope`);

  return (
    <header className="lf-list-header">
      <div className="lf-list-header__copy">
        <h1 className="lf-list-header__title">{title}</h1>
        {description && <p className="lf-list-header__count">{description}</p>}
        {help && (
          <details className="lf-help">
            <summary>How this works</summary>
            <div className="lf-help__body">{help}</div>
          </details>
        )}
      </div>
      {(actions || secondaryActions) && (
        <div className="lf-list-header__actions">
          {secondaryActions && (
            /* Native disclosure: no state to synchronise and keyboard
               reachable. It does NOT close itself — no browser dismisses a
               <details> on outside click, despite what this comment used to
               say — so the top bar installs one delegated listener that closes
               these on outside click, Escape and item selection. */
            <details className="lf-overflow">
              <summary className="lf-btn lf-btn--secondary lf-btn--sm" aria-label="More actions" title="More actions">
                <span aria-hidden="true">•••</span>
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
