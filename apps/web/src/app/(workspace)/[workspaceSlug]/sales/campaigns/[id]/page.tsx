import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import Badge, { type Tone } from '@/components/ui/Badge';
import { can } from '@/lib/security/rbac';
import CampaignSend from './CampaignSend';

export const metadata = { title: 'Campaign Detail' };

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'slate',
  SCHEDULED: 'brass',
  RUNNING: 'viridian',
  PAUSED: 'brass',
  COMPLETED: 'slate',
  CANCELLED: 'vermillion',
};

export default async function CampaignDetailPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['campaigns', 'VIEW'] });

  const [campaign, scripts, talkingPoints, qualifications, members, leadCount] = await Promise.all([
    prisma.campaign.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId },
      include: { owner: { select: { id: true, fullName: true } } },
    }),
    prisma.campaignScript.findMany({
      where: { tenantId: ctx.tenantId, campaignId: params.id },
      orderBy: { position: 'asc' },
    }),
    prisma.campaignTalkingPoint.findMany({
      where: { tenantId: ctx.tenantId, campaignId: params.id },
      orderBy: { position: 'asc' },
    }),
    prisma.campaignQualification.findMany({
      where: { tenantId: ctx.tenantId, campaignId: params.id },
      orderBy: { position: 'asc' },
    }),
    prisma.campaignMember.findMany({
      where: { tenantId: ctx.tenantId, campaignId: params.id, removedAt: null },
    }),
    prisma.lead.count({
      where: { tenantId: ctx.tenantId, campaignId: params.id, deletedAt: null },
    }),
  ]);

  if (!campaign) notFound();

  // Mirrors the server-side eligibility rule in /api/v1/campaigns/[id]/send so the
  // button never promises to reach leads that consent will exclude.
  const eligible = await prisma.lead.count({
    where: {
      tenantId: ctx.tenantId,
      campaignId: params.id,
      deletedAt: null,
      doNotCall: false,
      consentStatus: { in: ['GRANTED', 'IMPLIED'] },
      phone: { not: null },
      communications: { none: { campaignId: params.id, channel: 'WHATSAPP', status: { not: 'FAILED' } } },
    },
  });

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 'var(--lf-space-5)',
        }}
      >
        <div>
          <h1 className="lf-h1">{campaign.name}</h1>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
            {campaign.campaignType} · {campaign.code}
            {campaign.owner && ` · Owned by ${campaign.owner.fullName}`}
          </p>
        </div>
        <Badge tone={STATUS_TONE[campaign.status]}>{campaign.status.toLowerCase()}</Badge>
      </div>

      {can(ctx, 'campaigns', 'EDIT') && <CampaignSend campaignId={campaign.id} eligible={eligible} />}

      {/* Metrics row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 'var(--lf-space-4)',
          marginBottom: 'var(--lf-space-5)',
        }}
      >
        <div className="lf-card" style={{ padding: 'var(--lf-space-4)', textAlign: 'center' }}>
          <div className="lf-num" style={{ fontSize: 'var(--lf-text-2xl)', fontWeight: 700 }}>
            {leadCount}
          </div>
          <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>Leads</div>
        </div>
        <div className="lf-card" style={{ padding: 'var(--lf-space-4)', textAlign: 'center' }}>
          <div className="lf-num" style={{ fontSize: 'var(--lf-text-2xl)', fontWeight: 700 }}>
            {members.length}
          </div>
          <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>Members</div>
        </div>
        <div className="lf-card" style={{ padding: 'var(--lf-space-4)', textAlign: 'center' }}>
          <div className="lf-num" style={{ fontSize: 'var(--lf-text-2xl)', fontWeight: 700 }}>
            {scripts.length}
          </div>
          <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>Scripts</div>
        </div>
        <div className="lf-card" style={{ padding: 'var(--lf-space-4)', textAlign: 'center' }}>
          <div className="lf-num" style={{ fontSize: 'var(--lf-text-2xl)', fontWeight: 700 }}>
            {talkingPoints.length}
          </div>
          <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>Talking Points</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--lf-space-4)' }}>
        {/* Scripts */}
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
            Call Scripts
          </div>
          {scripts.length === 0 ? (
            <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
              No scripts defined. Add scripts via the API.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
              {scripts.map((s) => (
                <div
                  key={s.id}
                  style={{ borderBottom: '1px solid var(--lf-line)', paddingBottom: 'var(--lf-space-3)' }}
                >
                  <div style={{ fontWeight: 600, fontSize: 'var(--lf-text-sm)', marginBottom: 4 }}>
                    {s.title} {s.isDefault && <Badge tone="viridian">default</Badge>}
                  </div>
                  <div style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)', whiteSpace: 'pre-wrap' }}>
                    {s.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Talking Points + Qualifications */}
        <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
          <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
            <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
              Required Talking Points
            </div>
            {talkingPoints.length === 0 ? (
              <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>No talking points defined.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 'var(--lf-space-5)' }}>
                {talkingPoints.map((tp) => (
                  <li key={tp.id} style={{ fontSize: 'var(--lf-text-sm)', marginBottom: 6, color: 'var(--lf-ink-2)' }}>
                    <span style={{ fontWeight: tp.isRequired ? 600 : 400 }}>{tp.label}</span>
                    {tp.isRequired && (
                      <>
                        {' '}
                        <Badge tone="wine">required</Badge>
                      </>
                    )}
                    {tp.description && (
                      <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>{tp.description}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
            <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
              Qualification Questions
            </div>
            {qualifications.length === 0 ? (
              <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
                No qualification questions defined.
              </p>
            ) : (
              <ol style={{ margin: 0, paddingLeft: 'var(--lf-space-5)' }}>
                {qualifications.map((q) => (
                  <li key={q.id} style={{ fontSize: 'var(--lf-text-sm)', marginBottom: 8, color: 'var(--lf-ink-2)' }}>
                    <div style={{ fontWeight: 500 }}>{q.question}</div>
                    {q.expectedAnswer && (
                      <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)', marginTop: 2 }}>
                        Expected: {q.expectedAnswer}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
