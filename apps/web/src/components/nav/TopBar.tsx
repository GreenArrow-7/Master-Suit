'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * The HR breadcrumb's page name, from the path: `/{slug}/people/work-locations`
 * reads as "Work locations". The module root is "Overview".
 */
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
  actionUrl: string | null;
  priority: string;
  readAt: string | null;
  createdAt: string;
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

  // Fetch unread count on mount
  useEffect(() => {
    if (module === 'platform') return;
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

  const CREATE_ITEMS =
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
            { label: 'Lead', href: `${basePath}/sales/leads/new`, module: 'leads' },
            { label: 'Opportunity', href: `${basePath}/sales/opportunities/new`, module: 'opportunities' },
            { label: 'Account', href: `${basePath}/sales/accounts/new`, module: 'accounts' },
            { label: 'Contact', href: `${basePath}/sales/contacts/new`, module: 'contacts' },
            { label: 'Call', href: `${basePath}/sales/calls/new`, module: 'calls' },
            { label: 'Event', href: `${basePath}/sales/events/new`, module: 'events' },
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
        ? { href: '/platform/workspaces', placeholder: 'Search workspaces…', label: 'Search workspaces' }
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
        <input
          ref={search}
          name="q"
          type="search"
          className="lf-input"
          placeholder={target.placeholder}
          aria-label={target.label}
          style={{ paddingRight: 46 }}
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

      <div className="lf-shell-actions" hidden={module === 'people'}>
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
                          cursor: n.actionUrl ? 'pointer' : 'default',
                        }}
                        onClick={() => {
                          if (!n.readAt) markRead([n.id]);
                          if (n.actionUrl) window.location.href = n.actionUrl;
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
          className="lf-btn lf-btn--ghost lf-btn--sm"
          onClick={() => {
            void fetch('/api/v1/auth/logout', { method: 'POST' }).finally(() => {
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
              {CREATE_ITEMS.map((item) => (
                <a
                  key={item.href}
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
                >
                  {item.label}
                </a>
              ))}
            </div>
          )}
        </div>
        )}
      </div>
    </header>
  );
}
