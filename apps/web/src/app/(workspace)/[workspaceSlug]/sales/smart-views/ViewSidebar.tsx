'use client';

import SalesLink from '@/components/workspace/SalesLink';

interface Props {
  systemViews: { key: string; name: string; icon: string }[];
  savedViews: { id: string; name: string; mine: boolean }[];
  activeSystemKey: string | null;
  activeSavedId: string | null;
}

export default function ViewSidebar({ systemViews, savedViews, activeSystemKey, activeSavedId }: Props) {
  return (
    <aside
      className="lf-smartviews-sidebar"
      style={{
        width: 220,
        flex: 'none',
        borderRight: '1px solid var(--lf-line)',
        paddingRight: 'var(--lf-space-4)',
        overflowY: 'auto',
      }}
    >
      <div className="lf-eyebrow" style={{ padding: '0 0 6px', color: 'var(--lf-ink-3)' }}>
        System Views
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {systemViews.map((v) => {
          const active = activeSystemKey === v.key;
          return (
            <li key={v.key}>
              <SalesLink
                href={v.key === 'all' ? '/smart-views' : `/smart-views?view=${v.key}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--lf-space-2)',
                  padding: '5px 8px',
                  borderRadius: 'var(--lf-radius-sm)',
                  fontSize: 'var(--lf-text-sm)',
                  textDecoration: 'none',
                  color: active ? 'var(--lf-wine-700)' : 'var(--lf-ink-2)',
                  background: active ? 'var(--lf-wine-050)' : 'transparent',
                  fontWeight: active ? 600 : 400,
                  transition: 'background 100ms ease',
                }}
              >
                <span style={{ width: 16, textAlign: 'center', fontSize: 10, opacity: 0.7 }}>{v.icon}</span>
                {v.name}
              </SalesLink>
            </li>
          );
        })}
      </ul>

      {savedViews.length > 0 && (
        <>
          <div className="lf-eyebrow" style={{ padding: 'var(--lf-space-4) 0 6px', color: 'var(--lf-ink-3)' }}>
            Saved Views
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {savedViews.map((v) => {
              const active = activeSavedId === v.id;
              return (
                <li key={v.id}>
                  <SalesLink
                    href={`/smart-views?id=${v.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--lf-space-2)',
                      padding: '5px 8px',
                      borderRadius: 'var(--lf-radius-sm)',
                      fontSize: 'var(--lf-text-sm)',
                      textDecoration: 'none',
                      color: active ? 'var(--lf-wine-700)' : 'var(--lf-ink-2)',
                      background: active ? 'var(--lf-wine-050)' : 'transparent',
                      fontWeight: active ? 600 : 400,
                      transition: 'background 100ms ease',
                    }}
                  >
                    <span style={{ width: 16, textAlign: 'center', fontSize: 10, opacity: 0.7 }}>◈</span>
                    {v.name}
                    {!v.mine && (
                      <span style={{ marginLeft: 'auto', fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-4)' }}>
                        shared
                      </span>
                    )}
                  </SalesLink>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </aside>
  );
}
