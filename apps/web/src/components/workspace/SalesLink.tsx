'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The workspace module a page is rendered under — `/{slug}/sales`, `/{slug}/admin`,
 * `/{slug}/people`. Pages inside a module link to each other with module-relative
 * paths (`/leads`, `/calls/new`); this supplies the prefix without every server
 * component having to thread the workspace slug through its props.
 */
export function useModuleBase(): string {
  const segments = usePathname().split('/').filter(Boolean);
  return `/${segments.slice(0, 2).join('/')}`;
}

type Props = Omit<React.ComponentPropsWithoutRef<'a'>, 'href'> & { href: string };

/**
 * A link relative to the current workspace module. Absolute URLs, anchors and
 * paths already carrying the workspace prefix pass through untouched, so an
 * external meeting link or an `#anchor` still behaves like a plain anchor.
 */
export default function SalesLink({ href, ...rest }: Props) {
  const base = useModuleBase();
  // True externals (mailto:, https://, #anchor) stay plain anchors; everything
  // else goes through next/link so navigation is client-side instead of a full
  // document load on every click.
  if (/^([a-z]+:|\/\/|#)/i.test(href)) return <a href={href} {...rest} />;
  const prefixed = /^\?/.test(href) || href.startsWith(`${base}/`) || href === base;
  return <Link href={prefixed ? href : `${base}${href}`} {...rest} />;
}
