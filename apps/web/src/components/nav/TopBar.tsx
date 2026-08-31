'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { applyTheme, THEMES, THEME_LABELS } from '@/lib/theme';
import { useTheme } from '@/lib/useTheme';

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

/**
 * The bell, as a path rather than 🔔.
 *
 * An emoji renders as a different picture on every platform — a flat outline on
 * one, a saturated colour glyph on another — and cannot take `currentColor`, so
 * it would ignore both themes. This inherits the button's colour and sits on the
 * same optical baseline as the other icons in the bar.
 */
function BellIcon({ ringing }: { ringing: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
      <path d="M13.7 20a2 2 0 0 1-3.4 0" />
      {/* Two short strokes, drawn only when something is waiting: the badge
          carries the count, this carries the glance. */}
      {ringing && <path d="M20.5 5.5c.6.8 1 1.8 1 2.9M3.5 5.5c-.6.8-1 1.8-1 2.9" opacity="0.65" />}
    </svg>
  );
}

/**
 * One glyph per family of event, so a panel of twenty rows can be scanned
 * without reading every title.
 *
 * Two naming conventions have to be understood, because the table holds both:
 * `LEAD_ASSIGNED` from the seed and `CALL_ANALYSIS_READY` from call
 * intelligence, alongside the dotted `lead.created` / `call.missed` that the CRM
 * and HR registries write. Normalising to a common form and matching the leading
 * segment covers both without a lookup table that would need a new entry every
 * time an event is added.
 *
 * An unrecognised kind gets the neutral ring rather than nothing, so a new event
 * type is never invisible.
 */
function kindGlyph(kind: string): { glyph: string; label: string } {
  const family = kind.toLowerCase().replace(/_/g, '.').split('.')[0] ?? '';
  switch (family) {
    case 'lead':
      return { glyph: '◆', label: 'Lead' };
    case 'call':
      return { glyph: '●', label: 'Call' };
    case 'follow':
    case 'task':
      return { glyph: '▲', label: 'Follow-up' };
    case 'sla':
      return { glyph: '■', label: 'SLA' };
    case 'target':
      return { glyph: '▰', label: 'Target' };
    default:
      // Everything HR raises, and anything added later.
      return { glyph: '○', label: 'Notification' };
  }
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
  /**
   * Subscribed, not stored here. The pre-paint script in the root layout has
   * already applied the theme to the document; this only needs to know which one
   * so the quick toggle can name the next.
   */
  const theme = useTheme();

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
   * The <details> menus close like menus, not like accordions.
   *
   * Two comments in this codebase — one here, one in ListHeader — claimed the
   * browser closes a native disclosure on outside click. No browser does: a
   * <details> stays open until its summary is clicked again, which on a phone
   * meant the ••• action panel sat over the content until somebody found the
   * button again. One delegated listener covers every such menu in the product
   * (the list-header ••• and the account menu), because per-component copies of
   * this logic are how one of them ends up without it.
   *
   * Escape closes too, and choosing an item closes the menu it lives in —
   * except the account menu's setting rows (row height, theme), which people
   * toggle repeatedly and expect to stay put.
   */
  useEffect(() => {
    const SELECTOR = 'details.lf-overflow[open], details.lf-account-menu[open]';
    const closeAll = (except?: Node | null) => {
      document.querySelectorAll<HTMLDetailsElement>(SELECTOR).forEach((menu) => {
        if (!except || !menu.contains(except)) menu.open = false;
      });
    };
    const onPointerDown = (e: PointerEvent) => closeAll(e.target as Node);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Links always dismiss; buttons dismiss in the ••• menu (Import, Export,
      // Columns act once) but not the account menu's toggles.
      if (target.closest('.lf-overflow__menu a, .lf-overflow__menu button, .lf-account-pop a')) closeAll();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClick);
    };
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
  useEffect(() => {
    if (module === 'platform') return;

    const refresh = () =>
      fetch('/api/v1/notifications?unread=true')
        .then((r) => r.json())
        .then((d) => setUnreadCount(d.unreadCount ?? 0))
        .catch(() => {});

    void refresh();

    /**
     * Polled, not pushed.
     *
     * The badge used to be fetched exactly once per mount and then never again,
     * so a lead assigned to you at 09:05 showed up whenever you next happened to
     * do a full page load. The shell is a persistent layout — soft navigation
     * does not remount it — so "once per mount" could mean once a day.
     *
     * A minute is the interval because the payload is a single integer and the
     * query is served by the (tenantId, userId, readAt, createdAt) index the
     * model already carries. Server-sent events would be tidier and are the
     * upgrade path; they need a connection per signed-in tab held open through
     * whatever proxy sits in front of this, which is a materially bigger thing
     * to own than one cheap request a minute.
     *
     * The visibility check keeps background tabs off the wire entirely: a
     * browser with nine workspaces open should poll for the one being looked at.
     */
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60_000);

    // Catches up immediately on return rather than waiting out the interval.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
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
        {/*
         * Density, theme, help and sign-out, in one menu.
         *
         * These were four separate buttons in a bar that already carried ten
         * controls, and three of them are set once and then never touched.
         * Collapsing them leaves the bar holding only what people press daily:
         * search, Dashboard, the bell and Create.
         *
         * Deliberately NOT `lf-topbar-optional`. Three of the four used to carry
         * that class — `display: none` at the tablet and phone breakpoints —
         * but Sign out did not, for the reason recorded where it used to live:
         * the sidebar's own sign-out is behind the drawer on a phone and absent
         * on a tablet, so this is the only way out of the product at those
         * widths. Folding it into a menu that vanished below 1024px would have
         * reintroduced exactly that bug.
         *
         * `<details>` rather than component state: the browser handles toggling
         * and Escape, and it is the pattern the Help disclosure already used.
         */}
        <details className="lf-account-menu" style={{ position: 'relative' }}>
          <summary
            className="lf-btn lf-btn--ghost lf-btn--sm"
            style={{ listStyle: 'none', cursor: 'pointer' }}
            aria-label="Preferences and account"
            title="Preferences and account"
          >
            {'⋯'}
          </summary>

          <div className="lf-pop lf-account-pop">
            <div className="lf-account-pop__group">
              <span className="lf-eyebrow">Display</span>
              <button
                className="lf-account-pop__item"
                onClick={() => setDensity((d) => (d === 'compact' ? 'comfortable' : 'compact'))}
                aria-pressed={density === 'compact'}
              >
                <span>Row height</span>
                <span className="lf-account-pop__value">{density === 'compact' ? 'Compact' : 'Comfortable'}</span>
              </button>
              {/*
               * The quick cycle. Settings → Appearance explains the three and is
               * where the preference is described; this is the shortcut for
               * somebody who just wants the lights off, so it names the theme it
               * switches *to* rather than the one in use.
               */}
              <button
                className="lf-account-pop__item"
                onClick={() => applyTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!)}
              >
                <span>Theme</span>
                <span className="lf-account-pop__value">{THEME_LABELS[theme].name}</span>
              </button>
              <Link className="lf-account-pop__item" href={`${basePath}/profile/appearance`}>
                <span>Appearance settings</span>
              </Link>
            </div>

            <div className="lf-account-pop__group">
              <span className="lf-eyebrow">Help</span>
              <span className="lf-account-pop__note">
                Press <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> to jump to search.
              </span>
              <span className="lf-account-pop__note">Use + Create for new leads, tasks and calls.</span>
              <span className="lf-account-pop__note">Manage columns on any list via Columns.</span>
              <span className="lf-account-pop__note">
                Need access or a password reset? Contact your workspace administrator.
              </span>
            </div>

            <div className="lf-account-pop__group">
              <button
                className="lf-account-pop__item"
                onClick={() => {
                  void fetch('/api/v1/auth/logout', { method: 'POST' }).finally(() => {
                    window.location.href = '/login';
                  });
                }}
              >
                <span>Sign out</span>
              </button>
            </div>
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
              style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
              aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
              aria-expanded={notiOpen}
              title="Notifications"
            >
              <BellIcon ringing={unreadCount > 0} />
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
              <div className="lf-pop lf-noti-panel" role="dialog" aria-label="Notifications">
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
                        className="lf-noti-row"
                        data-unread={n.readAt ? undefined : ''}
                        style={{ cursor: destinationOf(n) ? 'pointer' : 'default' }}
                        /* A clickable <li> is invisible to the keyboard: no tab
                           stop, no Enter. Button semantics on the row keep the
                           existing markup while making it operable. */
                        role={destinationOf(n) ? 'button' : undefined}
                        tabIndex={destinationOf(n) ? 0 : undefined}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            (e.currentTarget as HTMLElement).click();
                          }
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
                          {/* Type marker, and the unread dot in the same slot:
                              two indicators competing for the left gutter is
                              what makes a notification list look busy. */}
                          <span
                            aria-hidden="true"
                            title={kindGlyph(n.kind).label}
                            style={{
                              flex: '0 0 auto',
                              width: 18,
                              lineHeight: '20px',
                              textAlign: 'center',
                              fontSize: 10,
                              color: n.readAt ? 'var(--lf-ink-3)' : 'var(--lf-wine-600)',
                            }}
                          >
                            {kindGlyph(n.kind).glyph}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 'var(--lf-text-sm)',
                                fontWeight: n.readAt ? 400 : 600,
                                color: 'var(--lf-ink)',
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

        {/* Sign out has moved into the account menu above. It stays reachable
            at every width for the reason recorded there: the sidebar's own
            control is absent on tablet and behind the drawer on a phone, so
            this is the only way out of the product at those sizes. */}

        {/* Create dropdown — absent entirely for roles that can create nothing. */}
        {CREATE_ITEMS.length > 0 && (
          <div ref={createRef} style={{ position: 'relative' }}>
            <button className="lf-btn lf-btn--sm" onClick={() => setCreateOpen((o) => !o)}>
              + Create
            </button>

            {createOpen && (
              <div className="lf-pop lf-create-menu" role="menu">
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
                        color: 'var(--lf-ink)',
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
