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
  description: override,
  eyebrow,
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
  /** Off by default — the reference screen carries no eyebrow above its title. */
  eyebrow?: string;
  actions?: ReactNode;
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
        {eyebrow && <div className="lf-eyebrow">{eyebrow}</div>}
        <h1 className="lf-list-header__title">{title}</h1>
        {description && <p className="lf-list-header__count">{description}</p>}
      </div>
      {actions && <div className="lf-list-header__actions">{actions}</div>}
    </header>
  );
}
