import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The one h1 treatment: a title, one line of context, and a right slot that is
 * either plain meta text (`meta`) or controls (`actions`). The dashboard used
 * to hand-roll its own header; the product now has one.
 *
 * `eyebrow` is still accepted so the pages that pass one compile, and is not
 * rendered: eyebrow + breadcrumb + title was three lines saying one thing.
 */
export default function PageHeader({
  title,
  description,
  breadcrumbs,
  meta,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  breadcrumbs?: { label: string; href?: string }[];
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="lf-page-header">
      <div className="lf-page-header__copy">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="lf-breadcrumbs" aria-label="Breadcrumb">
            {breadcrumbs.map((item, index) => (
              <span key={`${item.label}-${index}`}>
                {index > 0 && <span aria-hidden="true">/ </span>}
                {item.href ? <Link href={item.href}>{item.label}</Link> : item.label}
              </span>
            ))}
          </nav>
        )}
        <h1 className="lf-page-title">{title}</h1>
        {description && <p className="lf-page-description">{description}</p>}
      </div>
      {meta && <div className="lf-page-header__meta">{meta}</div>}
      {actions && <div className="lf-page-actions">{actions}</div>}
    </header>
  );
}
