'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import TemplateSendDialog, { type MessageChannel } from '../TemplateSendDialog';

export interface LeadMessaging {
  /** The numbers marked as on WhatsApp, main first, labelled as the viewer reads them. */
  numbers: { id: string; label: string }[];
  /** Why WhatsApp cannot go to this lead (opted out, no number marked), or null. */
  whatsappBlocked: string | null;
  emailBlocked: string | null;
}

/**
 * Send a WhatsApp template or an email template from the lead's Overview
 * (M4-28). Shown to a viewer who may send (`communications:CREATE`) and whose
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
  const [open, setOpen] = useState<MessageChannel | null>(null);
  const [sent, setSent] = useState(false);
  const reasons = [messaging.whatsappBlocked, messaging.emailBlocked].filter(Boolean);

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
      {open && (
        <TemplateSendDialog
          channel={open}
          target={{ leadId: lead.id, fullName: lead.fullName, numbers: messaging.numbers }}
          onClose={() => setOpen(null)}
          onSent={() => {
            setSent(true);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}
