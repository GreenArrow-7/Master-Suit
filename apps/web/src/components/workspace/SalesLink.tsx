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
  const base = `/${segments.slice(0, 2).join('/')}`;
  /**
   * A development-time guard, because this hook's failure mode is silent.
   *
   * Resolving against the current path is right for a Sales page linking to
   * another Sales page, and wrong the moment a component that renders *outside*
   * a module links *into* one. The assistant widget did exactly that: mounted in
   * the workspace layout, it rendered lead chips on Notifications and resolved
   * them to `/{slug}/notifications/leads/{id}`. Nothing complained; the links
   * simply 404'd.
   *
   * Anything rendered from the workspace layout — anything that can appear on a
   * screen outside a module — must use `entityRoute()` in `@/lib/nav/entityRoute`
   * instead, which takes the workspace slug and ignores the current path.
   */
  if (process.env.NODE_ENV !== 'production' && segments.length >= 2 && !MODULE_ROOTS.has(segments[1]!)) {
    console.warn(
      `SalesLink resolved a module base of "${base}", which is not a module root. ` +
        'A component rendering outside a module must use entityRoute() from @/lib/nav/entityRoute.',
    );
  }
  return base;
}

/** The second path segment of every screen a module-relative link is valid on. */
const MODULE_ROOTS = new Set(['sales', 'people', 'admin', 'profile']);

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
