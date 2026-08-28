'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The phone's primary navigation.
 *
 * A 40-to-54 link sidebar slid in from the left was the only way to move around
 * on a phone: every journey started with a hamburger, a drawer, and a scroll
 * through sections built for a 1440px screen. This puts the handful of
 * destinations a salesperson actually uses in the thumb's reach, and leaves the
 * drawer for the long tail.
 *
 * Four destinations plus Menu, deliberately: a fifth competes for width at
 * 320px, and the ones chosen are the daily loop — where am I, who do I call,
 * what did I promise, what is overdue. Everything else is one tap further away
 * rather than one tap closer.
 *
 * Rendered by the workspace layout and hidden above the phone tier, so no page
 * has to know it exists.
 */

const ICONS: Record<string, string> = {
  overview: 'M3 10.5 12 3l9 7.5 M5 9.5V21h5v-6h4v6h5V9.5',
  leads: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 21a8 8 0 0 1 16 0',
  calls: 'M5 4h4l2 5-3 2a16 16 0 0 0 5 5l2-3 5 2v4c0 1-1 2-2 2A17 17 0 0 1 3 6c0-1 1-2 2-2',
  tasks: 'M4 6h16 M4 12h16 M4 18h16',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
};

function Icon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

export default function MobileTabBar({ slug, module }: { slug: string; module: 'sales' | 'people' }) {
  const pathname = usePathname();

  // The daily loop differs by module; the shape does not.
  const items =
    module === 'people'
      ? [
          { key: 'overview', label: 'Home', href: `/${slug}/people` },
          { key: 'tasks', label: 'Leave', href: `/${slug}/people/leave` },
          { key: 'calls', label: 'Check in', href: `/${slug}/people/check-in` },
          { key: 'leads', label: 'People', href: `/${slug}/people/employees` },
        ]
      : [
          { key: 'overview', label: 'Home', href: `/${slug}/dashboard` },
          { key: 'leads', label: 'Leads', href: `/${slug}/sales/leads` },
          { key: 'calls', label: 'Calls', href: `/${slug}/sales/calls` },
          { key: 'tasks', label: 'Tasks', href: `/${slug}/tasks` },
        ];

  return (
    <nav className="lf-tabbar" aria-label="Primary">
      {items.map((item) => {
        // Longest-match wins, so /sales/leads/123 still lights up Leads while
        // the dashboard does not claim every route beneath the workspace.
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.key} href={item.href} className="lf-tabbar__item" aria-current={active ? 'page' : undefined}>
            <Icon name={item.key} />
            <span>{item.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        className="lf-tabbar__item"
        // The drawer owns its own open state; this asks for it rather than
        // lifting that state into a shared context for one button.
        onClick={() => window.dispatchEvent(new CustomEvent('lf:open-nav'))}
        aria-haspopup="dialog"
      >
        <Icon name="menu" />
        <span>Menu</span>
      </button>
    </nav>
  );
}
