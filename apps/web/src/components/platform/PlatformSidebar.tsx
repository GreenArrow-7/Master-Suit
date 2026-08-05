'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { PRODUCT_NAME } from '@/lib/branding';

const items = [
  ['Overview', '/platform'],
  ['Workspaces', '/platform/workspaces'],
  ['Subscriptions', '/platform/subscriptions'],
  ['Plans', '/platform/plans'],
  ['Users', '/platform/users'],
  ['Audit logs', '/platform/audit'],
  ['System health', '/platform/system-health'],
  ['Platform settings', '/platform/settings'],
] as const;

export default function PlatformSidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  return <>
    <button className="lf-mobile-nav-button" onClick={() => setMobileOpen((value) => !value)} aria-label="Open platform navigation">☰</button>
    <aside className="lf-workspace-sidebar" data-collapsed={collapsed} data-mobile-open={mobileOpen}>
      <div className="lf-sidebar-brand">
        <Link href="/platform" className="lf-brand-mark" aria-label="Platform overview">M</Link>
        {!collapsed && <div className="lf-brand-copy"><strong>{PRODUCT_NAME}</strong><span>Platform control centre</span></div>}
        <button className="lf-sidebar-collapse" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}>{collapsed ? '›' : '‹'}</button>
      </div>
      {!collapsed && <div style={{ margin: '0 14px 18px', padding: '9px 10px', border: '1px solid rgb(255 255 255 / .1)', borderRadius: 7, background: 'rgb(255 255 255 / .05)' }}>
        <div style={{ color: '#fff', fontSize: 10, fontWeight: 650 }}>Platform owner</div>
        <div style={{ marginTop: 2, color: 'rgb(255 255 255 / .42)', fontSize: 9 }}>Global administration</div>
      </div>}
      <nav className="lf-sidebar-nav" aria-label="Platform">
        <section className="lf-nav-section">
          {!collapsed && <div className="lf-nav-label">Control centre</div>}
          {items.map(([label, href]) => {
            const active = href === '/platform' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
            return <Link key={href} className="lf-nav-link" href={href} aria-current={active ? 'page' : undefined} title={collapsed ? label : undefined}>
              <span className="lf-nav-icon" style={{ display: 'grid', placeItems: 'center', fontSize: 11 }} aria-hidden="true">{label.slice(0, 1)}</span>
              {!collapsed && label}
            </Link>;
          })}
        </section>
      </nav>
      <div className="lf-sidebar-user"><span className="lf-avatar" style={{ background: 'rgb(255 255 255 / .11)', color: '#fff' }}>O</span>{!collapsed && <div className="lf-sidebar-user-copy"><strong>{email}</strong><span>Platform owner</span></div>}</div>
    </aside>
  </>;
}
