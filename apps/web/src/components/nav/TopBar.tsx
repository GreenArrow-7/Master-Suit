'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth/signOut';

/**
 * The HR breadcrumb's page name, from the path: `/{slug}/people/work-locations`
 * reads as "Work locations". The module root is "Overview".
 */
function pageTitle(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  // /{slug}/sales/leads → "Leads"; /{slug}/dashboard → "Overview".
  const leaf = segments[segments.length - 1] ?? '';
  if (!leaf || leaf === 'dashboard') return 'Overview';
  // A record id is not a page name; fall back to its section.
  const words = /^[a-z0-9]{16,}$/i.test(leaf) ? (segments[segments.length - 2] ?? leaf) : leaf;
  const spaced = words.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function peoplePageTitle(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const tail = segments[2] === 'people' ? segments.slice(3) : segments.slice(1);
  const leaf = tail[tail.length - 1];
  if (!leaf) return 'Overview';
  const words = leaf.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  /**
   * Where this notification goes, resolved by the server from the record's type
   * and the slug of the workspace that owns it — see
   * `app/api/v1/notifications/route.ts`. Null when the record has no screen, in
   * which case the row is not clickable rather than clickable-and-wrong.
   */
  destination: string | null;
  /** An external link, for the rare notification that points outside the app. */
  actionUrl: string | null;
  priority: string;
  readAt: string | null;
  createdAt: string;
}

/**
 * The one place a notification turns into a destination.
 *
 * The server resolves `destination` from the record's type and the owning
 * workspace's slug. `actionUrl` is the fallback and now means only what its name
 * says: a link that points somewhere this application does not route to. It used
 * to hold bare paths like `/people/overtime`, which were pushed verbatim and
 * 404'd every time.
 */
function destinationOf(n: NotificationItem): string | null {
  return n.destination ?? n.actionUrl ?? null;
}

function relTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function TopBar({
  basePath = '',
  module = 'sales',
  workspaceName,
  plan,
  creatable,
}: {
  basePath?: string;
  module?: 'sales' | 'people' | 'platform';
  workspaceName?: string;
  plan?: string;
  /** Permission modules the signed-in role may CREATE; undefined = show all. */
  creatable?: string[];
} = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const search = useRef<HTMLInputElement>(null);
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Create dropdown
  const [createOpen, setCreateOpen] = useState(false);
  const createRef = useRef<HTMLDivElement>(null);

  // Notifications
  const [notiOpen, setNotiOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notiLoading, setNotiLoading] = useState(false);
  const notiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (createRef.current && !createRef.current.contains(e.target as Node)) setCreateOpen(false);
      if (notiRef.current && !notiRef.current.contains(e.target as Node)) setNotiOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /**
   * Fetch the unread count once per mount, wherever the bell renders.
   *
   * This was gated on `module === 'sales'`, on the belief that the People shell
   * hid the whole actions bar. It does not: the bar is marked `hidden`, but
   * `.lf-shell-actions { display: flex }` in globals.css is an author-origin
   * rule and beats the user agent's `[hidden] { display: none }`. So the bell
   * rendered on every People screen with a badge that was never fetched — and
   * People raises seventeen of the twenty-one notification events this system
   * generates. Platform still skips it: there are no notifications there at all.
   */
  const fetchedUnread = useRef(false);
  useEffect(() => {
    if (module === 'platform' || fetchedUnread.current) return;
    fetchedUnread.current = true;
    fetch('/api/v1/notifications?unread=true')
      .then((r) => r.json())
      .then((d) => setUnreadCount(d.unreadCount ?? 0))
      .catch(() => {});
  }, [module]);

  const loadNotifications = useCallback(() => {
    setNotiLoading(true);
    fetch('/api/v1/notifications')
      .then((r) => r.json())
      .then((d) => {
        setNotifications(d.data ?? []);
        setUnreadCount(d.unreadCount ?? 0);
      })
      .catch(() => {})
      .finally(() => setNotiLoading(false));
  }, []);

  const markRead = useCallback((ids: string[]) => {
    fetch('/api/v1/notifications', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
      .then((r) => r.json())
      .then((d) => {
        setUnreadCount(d.unreadCount ?? 0);
        setNotifications((prev) =>
          prev.map((n) => (ids.includes(n.id) ? { ...n, readAt: new Date().toISOString() } : n)),
        );
      })
      .catch(() => {});
  }, []);

  const CREATE_ITEMS: { label: string; href: string; module?: string; group?: string }[] =
    module === 'people'
      ? [{ label: 'Employee', href: `${basePath}/people/employees/new` }]
      : module === 'platform'
        ? [
            { label: 'Workspace', href: '/platform/workspaces/new' },
            { label: 'Plan', href: '/platform/plans' },
          ]
        : // Every one of these must land on a create form. They previously pointed at
          // list pages and a `#new` fragment that no screen implements, so the menu
          // looked complete while only navigating away.
          [
            { label: 'Lead', href: `${basePath}/sales/leads/new`, module: 'leads', group: 'Sales' },
            {
              label: 'Opportunity',
              href: `${basePath}/sales/opportunities/new`,
              module: 'opportunities',
              group: 'Sales',
            },
            { label: 'Account', href: `${basePath}/sales/accounts/new`, module: 'accounts', group: 'Sales' },
            { label: 'Contact', href: `${basePath}/sales/contacts/new`, module: 'contacts', group: 'Sales' },
            { label: 'Call', href: `${basePath}/sales/calls/new`, module: 'calls', group: 'Engage' },
            { label: 'Event', href: `${basePath}/sales/events/new`, module: 'events', group: 'Engage' },
          ].filter((item) => !creatable || creatable.includes(item.module));

  /**
   * Where the box actually goes, and copy that promises only that.
   *
   * It used to read "Search leads, accounts, opportunities…" over an input with
   * no handler, no form and no submit — typing did nothing and Enter did
   * nothing, while a ⌘K badge advertised a command palette that does not exist.
   * The shortcut did work: it focused a box that then ignored you.
   *
   * Rather than build cross-entity search, this sends the query to the list
   * each area already filters by `?q=`, and says which list that is.
   */
  const target =
    module === 'people'
      ? { href: `${basePath}/people/employees`, placeholder: 'Search employees…', label: 'Search employees' }
      : module === 'platform'
        ? // The owner's search means different things in the two halves of the
          // console. On the identity screens it must find a person, which is the
          // whole point of arriving there.
          pathname.startsWith('/platform/users')
          ? { href: '/platform/users', placeholder: 'Search users, email, workspace…', label: 'Search platform users' }
          : { href: '/platform/workspaces', placeholder: 'Search workspaces…', label: 'Search workspaces' }
        : { href: `${basePath}/sales/leads`, placeholder: 'Search leads…', label: 'Search leads' };

  return (
    <header className="lf-shell-topbar">
      {/* The HR module leads with the reference's breadcrumb — "Workspace ·
          Page" — before the operational controls. */}
      {module === 'people' && workspaceName && (
        <div className="lf-shell-crumb">
          {workspaceName} · <b>{peoplePageTitle(pathname)}</b>
        </div>
      )}
      {/* The HR topbar stays crumb-only: the employee directory carries its own
          search (labelled "Search employees"), so a topbar twin would give two
          controls one accessible name — and the pair overflows a 375px phone. */}
      {/* Phone only: the bar has to say where you are, because the desktop
          breadcrumb and the sidebar's active row are both off-screen. */}
      <span className="lf-appbar-title">{pageTitle(pathname)}</span>

      {module !== 'people' && (
        <form
          className="lf-shell-search"
          action={target.href}
          method="get"
          role="search"
          onSubmit={(event) => {
            // An empty query would navigate to the list with `?q=`, which reads as
            // a search that matched nothing rather than no search at all.
            if (!search.current?.value.trim()) event.preventDefault();
          }}
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--lf-ink-3)"
            strokeWidth="1.8"
            strokeLinecap="round"
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
          >
            <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={search}
            name="q"
            type="search"
            className="lf-input"
            placeholder={target.placeholder}
            aria-label={target.label}
            style={{ paddingRight: 46, paddingLeft: 30 }}
          />
          <kbd
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              padding: '2px 6px',
              borderRadius: 'var(--lf-radius-sm)',
              border: '1px solid var(--lf-line-2)',
              background: 'var(--lf-surface-2)',
              fontFamily: 'var(--lf-font-mono)',
              fontSize: 'var(--lf-text-2xs)',
              color: 'var(--lf-ink-3)',
            }}
          >
            ⌘K
          </kbd>
        </form>
      )}

      {/* The actions bar renders in every module.

          It used to carry `hidden={module === 'people'}`, which did nothing:
          `.lf-shell-actions { display: flex }` is an author-origin rule and
          overrides the user agent's `[hidden] { display: none }`, so the bar was
          visible on People regardless — only its unread badge was suppressed,
          which is the worst of both. The attribute is gone and the decision is
          made openly: People raises most of this system's notifications, so the
          people working in it need the bell, the workspace switcher's sibling
          controls and Log out as much as anyone. The one control that genuinely
          differs is the search box, which is already gated above. */}
      <div className="lf-shell-actions">
        {/* The dashboard is a destination, not an action: it leads the right
            cluster with an icon+label and a clear pressed state, quieter than
            + Create but always one click away. */}
        {(() => {
          const dashHref = module === 'platform' ? '/platform' : `${basePath}/dashboard`;
          const active = pathname === dashHref;
          return (
            <Link
              href={dashHref}
              className="lf-btn lf-btn--ghost lf-btn--sm lf-topbar-optional"
              aria-current={active ? 'page' : undefined}
              style={
                active ? { background: 'var(--lf-wine-050)', color: 'var(--lf-wine-700)', fontWeight: 600 } : undefined
              }
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 10.5 12 3l9 7.5 M5 9.5V21h5v-6h4v6h5V9.5" />
              </svg>
              Dashboard
            </Link>
          );
        })()}
        {workspaceName && (
          <span className="lf-topbar-optional" style={{ color: 'var(--lf-ink-2)', fontSize: 11, fontWeight: 600 }}>
            {workspaceName}
          </span>
        )}
        {plan && (
          <span className="lf-badge lf-topbar-optional" data-tone="wine">
            {plan}
          </span>
        )}
        <button
          className="lf-btn lf-btn--ghost lf-btn--sm lf-topbar-optional"
          onClick={() => setDensity((d) => (d === 'compact' ? 'comfortable' : 'compact'))}
          aria-pressed={density === 'compact'}
        >
          {density === 'compact' ? 'Comfortable' : 'Compact'}
        </button>
        <button
          className="lf-btn lf-btn--ghost lf-btn--sm lf-topbar-optional"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          aria-label="Toggle dark mode"
        >
          {theme === 'dark' ? '☾' : '☀'}
        </button>

        {/* Native disclosure: no state, closes on outside click via the browser. */}
        <details className="lf-topbar-optional" style={{ position: 'relative' }}>
          <summary className="lf-btn lf-btn--ghost lf-btn--sm" style={{ listStyle: 'none', cursor: 'pointer' }}>
            Help
          </summary>
          <div
            className="lf-card"
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 6px)',
              width: 260,
              padding: 'var(--lf-space-4)',
              zIndex: 50,
              fontSize: 'var(--lf-text-sm)',
              display: 'grid',
              gap: 'var(--lf-space-2)',
            }}
          >
            <strong>Quick help</strong>
            <span style={{ color: 'var(--lf-ink-2)' }}>
              Press <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> to jump to search.
            </span>
            <span style={{ color: 'var(--lf-ink-2)' }}>
              Use <em>+ Create</em> for new leads, tasks and calls.
            </span>
            <span style={{ color: 'var(--lf-ink-2)' }}>
              Manage columns on any list via <em>Columns</em>.
            </span>
            <span style={{ color: 'var(--lf-ink-2)' }}>
              Need access or a password reset? Contact your workspace administrator.
            </span>
          </div>
        </details>

        {/* Notifications */}
        {module !== 'platform' && (
          <div ref={notiRef} style={{ position: 'relative' }}>
            <button
              className="lf-btn lf-btn--secondary lf-btn--sm"
              onClick={() => {
                setNotiOpen((o) => !o);
                if (!notiOpen) loadNotifications();
              }}
              style={{ position: 'relative' }}
            >
              Notifications
              {unreadCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    background: 'var(--lf-vermillion)',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                    lineHeight: '18px',
                    textAlign: 'center',
                    padding: '0 4px',
                  }}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {notiOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 6,
                  width: 380,
                  maxHeight: 440,
                  overflowY: 'auto',
                  background: 'var(--lf-surface)',
                  border: '1px solid var(--lf-line)',
                  borderRadius: 'var(--lf-radius-md)',
                  boxShadow: 'var(--lf-shadow-lg)',
                  zIndex: 100,
                }}
              >
                <div
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--lf-line)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 'var(--lf-text-sm)' }}>Notifications</span>
                  {unreadCount > 0 && (
                    <button
                      className="lf-btn lf-btn--ghost lf-btn--sm"
                      style={{ fontSize: 'var(--lf-text-2xs)' }}
                      onClick={() => {
                        const unreadIds = notifications.filter((n) => !n.readAt).map((n) => n.id);
                        if (unreadIds.length) markRead(unreadIds);
                      }}
                    >
                      Mark all read
                    </button>
                  )}
                </div>

                {notiLoading ? (
                  <div
                    style={{
                      padding: 24,
                      textAlign: 'center',
                      color: 'var(--lf-ink-3)',
                      fontSize: 'var(--lf-text-sm)',
                    }}
                  >
                    Loading…
                  </div>
                ) : notifications.length === 0 ? (
                  <div
                    style={{
                      padding: 32,
                      textAlign: 'center',
                      color: 'var(--lf-ink-3)',
                      fontSize: 'var(--lf-text-sm)',
                    }}
                  >
                    No notifications yet
                  </div>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {notifications.map((n) => (
                      <li
                        key={n.id}
                        style={{
                          padding: '10px 16px',
                          borderBottom: '1px solid var(--lf-line)',
                          background: n.readAt ? 'transparent' : 'var(--lf-wine-050)',
                          cursor: destinationOf(n) ? 'pointer' : 'default',
                        }}
                        onClick={() => {
                          if (!n.readAt) markRead([n.id]);
                          const target = destinationOf(n);
                          if (!target) return;
                          setNotiOpen(false);
                          // Soft navigation keeps the layout (and this badge)
                          // mounted; anything non-internal falls back to a load.
                          if (target.startsWith('/')) router.push(target);
                          else window.location.href = target;
                        }}
                      >
                        <div
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 'var(--lf-text-sm)',
                                fontWeight: n.readAt ? 400 : 600,
                                color: 'var(--lf-ink-1)',
                              }}
                            >
                              {n.title}
                            </div>
                            {n.body && (
                              <div
                                style={{
                                  fontSize: 'var(--lf-text-2xs)',
                                  color: 'var(--lf-ink-3)',
                                  marginTop: 2,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {n.body}
                              </div>
                            )}
                          </div>
                          <span
                            style={{
                              fontSize: 'var(--lf-text-2xs)',
                              color: 'var(--lf-ink-4)',
                              whiteSpace: 'nowrap',
                              flexShrink: 0,
                            }}
                          >
                            {relTime(n.createdAt)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        <button
          className="lf-btn lf-btn--ghost lf-btn--sm lf-topbar-optional"
          onClick={() => {
            void signOut().finally(() => {
              window.location.href = '/login';
            });
          }}
        >
          Log out
        </button>

        {/* Create dropdown — absent entirely for roles that can create nothing. */}
        {CREATE_ITEMS.length > 0 && (
          <div ref={createRef} style={{ position: 'relative' }}>
            <button className="lf-btn lf-btn--sm" onClick={() => setCreateOpen((o) => !o)}>
              + Create
            </button>

            {createOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 6,
                  minWidth: 180,
                  background: 'var(--lf-surface)',
                  border: '1px solid var(--lf-line)',
                  borderRadius: 'var(--lf-radius-md)',
                  boxShadow: 'var(--lf-shadow-lg)',
                  zIndex: 100,
                  padding: '4px 0',
                }}
              >
                {CREATE_ITEMS.map((item, index) => (
                  <div key={item.href}>
                    {/* A group label when the group changes — after role filtering,
                      so an SDR who can only create leads sees no lone headings. */}
                    {item.group && item.group !== CREATE_ITEMS[index - 1]?.group && (
                      <div className="lf-eyebrow" style={{ padding: index === 0 ? '8px 16px 3px' : '10px 16px 3px' }}>
                        {item.group}
                      </div>
                    )}
                    <Link
                      href={item.href}
                      style={{
                        display: 'block',
                        padding: '8px 16px',
                        fontSize: 'var(--lf-text-sm)',
                        color: 'var(--lf-ink-1)',
                        textDecoration: 'none',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--lf-surface-2)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      // A soft navigation no longer tears the menu down; close it.
                      onClick={() => setCreateOpen(false)}
                    >
                      {item.label}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
