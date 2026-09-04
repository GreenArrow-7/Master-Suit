'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { COMPANY_NAME, PRODUCT_NAME } from '@/lib/branding';
import YouhanMark from '@/components/brand/YouhanMark';
import { buildWorkspaceNav, type IconName, type NavGroup, type NavItem } from '@/lib/nav/workspaceNav';

/**
 * The rail. One navigation for the whole product — see lib/nav/workspaceNav.ts
 * for the model and the reasoning. This component only decides how it renders:
 * a full rail on desktop, an icon rail on a tablet, a drawer on a phone.
 */
export default function WorkspaceSidebar({
  slug,
  name,
  modules,
  permitted,
  workspaces,
  user,
  serviceMode = false,
}: {
  slug: string;
  name: string;
  modules: string[];
  /** Permission modules the signed-in role may VIEW, resolved server-side. */
  permitted: string[];
  /** A platform service identity is viewing; the personal groups are dropped. */
  serviceMode?: boolean;
  workspaces: { slug: string; name: string }[];
  user: { name: string; role: string };
}) {
  const pathname = usePathname();
  const router = useRouter();
  // null = follow the tier; true/false = the viewer overrode it deliberately.
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  /**
   * The tablet tier collapses the rail automatically.
   *
   * Between 761px and 1023px there is room for desktop density but not for
   * desktop chrome. Rather than describe a second collapsed appearance in CSS,
   * this reuses the exact rendering the desktop collapse toggle produces.
   * `matchMedia`, not a resize listener: the browser evaluates the query, so
   * this fires once per crossing. The literal matches the tablet tier in
   * tokens.css.
   */
  const [tabletRail, setTabletRail] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 761px) and (max-width: 1023px)');
    const sync = () => setTabletRail(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  // The tier is the default, never a lock: a viewer who expands the rail on a
  // tablet keeps it expanded.
  const collapsed = userCollapsed ?? tabletRail;
  const setCollapsed = (next: boolean | ((value: boolean) => boolean)) =>
    setUserCollapsed(typeof next === 'function' ? next(collapsed) : next);

  /**
   * Which half of the product is open — the third path segment, not a substring.
   * Nothing in the rail changes with it any more; MobileTabBar and the top bar
   * still read it, and the navigation tests assert the attribute ModuleTheme
   * stamps from the same test.
   */
  const moduleSegment = pathname.split('/')[2];
  const activeModule: 'people' | 'sales' =
    moduleSegment === 'people'
      ? 'people'
      : moduleSegment === 'sales'
        ? 'sales'
        : modules.includes('SALES')
          ? 'sales'
          : 'people';

  useEffect(() => {
    window.localStorage.setItem(`master-suite:${slug}:module`, activeModule);
  }, [activeModule, slug]);

  // The bottom tab bar's Menu button asks for the drawer. An event rather than
  // lifted state: one button does not justify a context provider.
  useEffect(() => {
    const open = () => setMobileOpen(true);
    window.addEventListener('lf:open-nav', open);
    return () => window.removeEventListener('lf:open-nav', open);
  }, []);

  // The open drawer closes on Escape, like any dismissible surface.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const groups = useMemo<NavGroup[]>(
    () => buildWorkspaceNav({ slug, modules, permitted, serviceMode }),
    [slug, modules, permitted, serviceMode],
  );

  return (
    <>
      <button
        className="lf-mobile-nav-button"
        onClick={() => setMobileOpen((value) => !value)}
        aria-label="Open navigation"
        aria-expanded={mobileOpen}
      >
        ☰
      </button>
      {mobileOpen && <div className="lf-mobile-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />}
      <aside className="lf-workspace-sidebar" data-collapsed={collapsed} data-mobile-open={mobileOpen}>
        {/* Product first, workspace second: the top-left corner is where a
            person confirms which application they are in. The workspace sits
            beneath — still switchable, still always visible. */}
        <div className="lf-sidebar-brand">
          <Link href={`/${slug}/dashboard`} className="lf-brand-mark" aria-label={`${PRODUCT_NAME} — ${name} overview`}>
            <YouhanMark size={30} />
          </Link>
          {!collapsed && (
            <div className="lf-brand-copy">
              <strong>{PRODUCT_NAME}</strong>
              {workspaces.length > 1 ? (
                <select
                  className="lf-brand-workspace-switch"
                  value={slug}
                  aria-label="Switch workspace"
                  onChange={(event) => router.push(`/${event.target.value}/dashboard`)}
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.slug} value={workspace.slug}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span>{name}</span>
              )}
            </div>
          )}
          <button
            className="lf-sidebar-collapse"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        <nav className="lf-sidebar-nav" aria-label="Workspace">
          {groups.map((group) => {
            const inside = group.items.some((item) => isActive(item, pathname));
            const links = group.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
                onNavigate={() => setMobileOpen(false)}
              />
            ));
            /*
             * The long tail is a native <details>: no state, keyboard reachable,
             * and it remembers nothing — which is right, because it opens itself
             * whenever the current page is inside it. The icon rail forces every
             * group open; a collapsed group in a rail of icons is invisible.
             */
            return group.collapsible ? (
              <details key={group.key} className="lf-nav-group" open={collapsed || inside || undefined}>
                <summary className="lf-nav-label">{group.label}</summary>
                {links}
              </details>
            ) : (
              <section key={group.key} className="lf-nav-section">
                <div className="lf-nav-label">{group.label}</div>
                {links}
              </section>
            );
          })}
        </nav>

        <div className="lf-sidebar-account">
          <div className="lf-sidebar-user">
            <span className="lf-avatar" style={{ background: 'rgb(255 255 255 / .11)', color: '#fff' }}>
              {initials(user.name)}
            </span>
            {!collapsed && (
              <div className="lf-sidebar-user-copy">
                <strong>{user.name}</strong>
                <span>{user.role.replaceAll('_', ' ')}</span>
              </div>
            )}
          </div>
          {/* Sign-out lives in the top bar only — present at every width. */}
          {!collapsed && <div className="lf-sidebar-built-by">by {COMPANY_NAME}</div>}
        </div>
      </aside>
    </>
  );
}

/**
 * Module roots (`/{slug}/sales`, `/{slug}/people`, `/{slug}/dashboard`) match
 * exactly — prefix matching would light "Sales overview" on every sales page.
 * Query-string items (`/clients?view=referrals`) match on the full string only.
 */
function isActive(item: NavItem, pathname: string) {
  const [path, query] = item.href.split('?');
  if (query) return false;
  const moduleRoot = path.split('/').filter(Boolean).length <= 2;
  return pathname === path || (!moduleRoot && pathname.startsWith(`${path}/`));
}

function NavLink({
  item,
  pathname,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const active = isActive(item, pathname);
  return (
    <Link
      className="lf-nav-link"
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      onClick={onNavigate}
    >
      <Icon name={item.icon} />
      {!collapsed && item.label}
    </Link>
  );
}

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    home: 'M3 10.5 12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5z M9 21v-7h6v7',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
    task: 'M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01',
    lead: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 21a8 8 0 0 1 16 0',
    deal: 'M4 7h16v13H4z M8 7V4h8v3 M4 12h16',
    company: 'M4 21V4h10v17 M14 9h6v12 M8 8h2 M8 12h2 M8 16h2',
    contact: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M19 8v6 M22 11h-6',
    activity: 'M3 12h4l2-7 4 14 2-7h6',
    calendar: 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16',
    call: 'M5 4h4l2 5-3 2a16 16 0 0 0 5 5l2-3 5 2v4c0 1-1 2-2 2A17 17 0 0 1 3 6c0-1 1-2 2-2',
    campaign: 'M3 11v3h4l9 4V7l-9 4z M7 14l2 6',
    report: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
    people: 'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 21a6 6 0 0 1 12 0 M17 11a3 3 0 1 0 0-6 M16 16a5 5 0 0 1 6 5',
    attendance: 'M4 5h16v16H4z M8 3v4 M16 3v4 M8 14l3 3 5-6',
    leave: 'M12 21s7-4 7-11V4l-7-2-7 2v6c0 7 7 11 7 11 M9 12l2 2 4-5',
    org: 'M12 3v6 M5 21v-6h14v6 M5 15v-3h14v3 M9 9h6v3',
    document: 'M6 2h8l4 4v16H6z M14 2v5h5 M9 13h6 M9 17h6',
    settings:
      'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7 M19.4 15a2 2 0 0 0 .4 2.2l.1.1-2.6 2.6-.1-.1a2 2 0 0 0-2.2-.4 2 2 0 0 0-1.2 1.8V21H10v-.2A2 2 0 0 0 8.8 19a2 2 0 0 0-2.2.4l-.1.1-2.6-2.6.1-.1A2 2 0 0 0 4.4 15 2 2 0 0 0 2.6 13H2V9h.6a2 2 0 0 0 1.8-1.2A2 2 0 0 0 4 5.6l-.1-.1 2.6-2.6.1.1A2 2 0 0 0 8.8 3.4 2 2 0 0 0 10 1.6V1h4v.6a2 2 0 0 0 1.2 1.8 2 2 0 0 0 2.2-.4l.1-.1 2.6 2.6-.1.1a2 2 0 0 0-.4 2.2A2 2 0 0 0 21.4 9h.6v4h-.6a2 2 0 0 0-2 2z',
    shield: 'M12 22s8-4 8-12V4l-8-2-8 2v6c0 8 8 12 8 12 M9 12l2 2 4-5',
  };
  return (
    <svg
      className="lf-nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

const initials = (value: string) =>
  value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
