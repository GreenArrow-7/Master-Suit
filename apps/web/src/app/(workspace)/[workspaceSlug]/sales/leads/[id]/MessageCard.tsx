'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import TemplateSendDialog, { type MessageChannel } from '../TemplateSendDialog';
import SmsDialog from './SmsDialog';

export interface LeadMessaging {
  /** The numbers marked as on WhatsApp, main first, labelled as the viewer reads them. */
  numbers: { id: string; label: string }[];
  /** Why WhatsApp cannot go to this lead (opted out, no number marked), or null. */
  whatsappBlocked: string | null;
  emailBlocked: string | null;
  /** Why a text cannot go (no number, opted out, SMS not set up for the workspace), or null (M4-29). */
  smsBlocked: string | null;
}

/**
 * Send a WhatsApp template, an email template (M4-28) or a text (M4-29) from
 * the lead's Overview. Shown to a viewer who may send (`communications:CREATE`) and whose
 * `leads:EDIT` reaches the lead; a channel the lead cannot take says why.
 */
export default function MessageCard({
  lead,
  messaging,
}: {
  lead: { id: string; fullName: string };
  messaging: LeadMessaging;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<MessageChannel | 'SMS' | null>(null);
  const [sent, setSent] = useState(false);
  // Withdrawn consent stops every channel with one sentence: said once.
  const reasons = [
    ...new Set([messaging.whatsappBlocked, messaging.emailBlocked, messaging.smsBlocked].filter(Boolean)),
  ];
  const onSent = () => {
    setSent(true);
    router.refresh();
  };

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }} aria-label="Message the lead">
      <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
        Message
      </div>
      <div style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="lf-btn lf-btn--secondary lf-btn--sm"
          disabled={!!messaging.whatsappBlocked}
          onClick={() => setOpen('WHATSAPP')}
        >
          Send WhatsApp
        </button>
        <button
          type="button"
          className="lf-btn lf-btn--secondary lf-btn--sm"
          disabled={!!messaging.emailBlocked}
          onClick={() => setOpen('EMAIL')}
        >
          Send email
        </button>
        <button
          type="button"
          className="lf-btn lf-btn--secondary lf-btn--sm"
          disabled={!!messaging.smsBlocked}
          onClick={() => setOpen('SMS')}
        >
          Send SMS
        </button>
      </div>
      {reasons.map((reason) => (
        <p key={reason} className="lf-hint" style={{ margin: 'var(--lf-space-2) 0 0' }}>
          {reason}
        </p>
      ))}
      {sent && (
        <p className="lf-hint" role="status" style={{ margin: 'var(--lf-space-2) 0 0' }}>
          Sent. It is on the timeline.
        </p>
      )}
      {open === 'SMS' ? (
        <SmsDialog lead={lead} onClose={() => setOpen(null)} onSent={onSent} />
      ) : (
        open && (
          <TemplateSendDialog
            channel={open}
            target={{ leadId: lead.id, fullName: lead.fullName, numbers: messaging.numbers }}
            onClose={() => setOpen(null)}
            onSent={onSent}
          />
        )
      )}
    </section>
  );
}
