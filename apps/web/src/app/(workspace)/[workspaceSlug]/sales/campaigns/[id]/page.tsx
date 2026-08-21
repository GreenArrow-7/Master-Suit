import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import Badge, { type Tone } from '@/components/ui/Badge';
import { can } from '@/lib/security/rbac';
import SalesLink from '@/components/workspace/SalesLink';
import CampaignSend from './CampaignSend';
import AudiencePicker from './AudiencePicker';
import CampaignStatusActions from './CampaignStatusActions';

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

  // What actually reached people, by outcome — the campaign's scoreboard.
  const deliveryRows = await prisma.communication.groupBy({
    by: ['status'],
    where: { tenantId: ctx.tenantId, campaignId: campaign.id },
    _count: { _all: true },
  });
  const delivery = Object.fromEntries(deliveryRows.map((row) => [row.status, row._count._all]));
  const delivered = (delivery.DELIVERED ?? 0) + (delivery.READ ?? 0);
  const attempted = deliveryRows.reduce((sum, row) => sum + row._count._all, 0);

  // Only WhatsApp campaigns can be sent — services/campaigns/send hard-codes the
  // channel, and the API refuses the rest rather than quietly sending WhatsApp
  // to an SMS campaign's audience. Rendering the card here anyway would be the
  // same promise made one step earlier, so the page asks the same question the
  // server does. An unset channel is a pre-default row and still sends.
  const sendable = !campaign.channel || campaign.channel === 'WHATSAPP';

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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* The dial queue lives here rather than under Calls: a queue belongs
              to the campaign that decided who is in it. */}
          {can(ctx, 'dialer', 'VIEW') && (
            <SalesLink className="lf-btn lf-btn--sm" href={`/campaigns/${campaign.id}/dialer`}>
              Open dialer
            </SalesLink>
          )}
          {can(ctx, 'campaigns', 'EDIT') && <CampaignStatusActions id={campaign.id} status={campaign.status} />}
          <Badge tone={STATUS_TONE[campaign.status]}>{campaign.status.toLowerCase()}</Badge>
        </div>
      </div>

      {can(ctx, 'campaigns', 'EDIT') && (
        <div style={{ display: 'grid', gap: 'var(--lf-space-4)', marginBottom: 'var(--lf-space-5)' }}>
          {sendable ? (
            <CampaignSend campaignId={campaign.id} eligible={eligible} />
          ) : (
            <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
              <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
                Promotional send
              </div>
              <p style={{ margin: 0, fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
                {campaign.channel === 'VOICE'
                  ? 'This is a calling campaign. Its audience is worked from the dialer, not sent to — “Open dialer” above.'
                  : `This is a ${campaign.channel?.toLowerCase()} campaign, and nothing sends those yet. Only WhatsApp campaigns can be sent from here.`}
              </p>
            </section>
          )}
          <AudiencePicker campaignId={campaign.id} />
        </div>
      )}

      {attempted > 0 && (
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)', marginBottom: 'var(--lf-space-5)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
            Delivery
          </div>
          <div style={{ display: 'flex', gap: 'var(--lf-space-5)', flexWrap: 'wrap', fontSize: 'var(--lf-text-sm)' }}>
            <span>
              <strong className="lf-num">{attempted}</strong> attempted
            </span>
            <span>
              <strong className="lf-num">{delivery.SENT ?? 0}</strong> sent
            </span>
            <span>
              <strong className="lf-num">{delivered}</strong> delivered or read
            </span>
            <span>
              <strong className="lf-num">{delivery.REPLIED ?? 0}</strong> replied
            </span>
            <span style={{ color: (delivery.FAILED ?? 0) > 0 ? 'var(--lf-vermillion, #b3261e)' : undefined }}>
              <strong className="lf-num">{delivery.FAILED ?? 0}</strong> failed
            </span>
          </div>
        </section>
      )}

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
