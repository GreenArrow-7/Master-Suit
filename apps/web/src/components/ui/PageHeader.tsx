import Link from 'next/link';
import type { ReactNode } from 'react';

export default function PageHeader({
  eyebrow,
  title,
  description,
  breadcrumbs,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  breadcrumbs?: { label: string; href?: string }[];
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
        {eyebrow && <div className="lf-eyebrow">{eyebrow}</div>}
        <h1 className="lf-page-title">{title}</h1>
        {description && <p className="lf-page-description">{description}</p>}
      </div>
      {actions && <div className="lf-page-actions">{actions}</div>}
    </header>
  );
}
