'use client';

import { useState } from 'react';

/** What a stage asks for when a lead enters it (LeadStage.requiresReason, reasons). */
export interface ReasonedStage {
  id: string;
  name: string;
  requiresReason: boolean;
  reasons: string[];
}

export const asksForReason = (stage: ReasonedStage) => stage.requiresReason || stage.reasons.length > 0;

/**
 * The reason, or sub-status, a lead moves with: a list when the stage has one,
 * otherwise a sentence; optional unless the stage requires it. The server
 * checks the same rule, so this only saves the round trip.
 */
export default function StageReason({
  stage,
  busy,
  onMove,
  onCancel,
}: {
  stage: ReasonedStage;
  busy: boolean;
  onMove: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const field = {
    className: 'lf-input',
    'aria-label': `Reason for ${stage.name}`,
    required: stage.requiresReason,
    value: reason,
    style: { flex: '1 1 160px', minWidth: 0, fontSize: 'var(--lf-text-sm)' },
  };

  return (
    <form
      style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
      onSubmit={(event) => {
        event.preventDefault();
        onMove(reason.trim());
      }}
    >
      {stage.reasons.length ? (
        <select {...field} onChange={(event) => setReason(event.target.value)}>
          <option value="">{stage.requiresReason ? 'Choose a reason…' : 'No reason'}</option>
          {stage.reasons.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input {...field} placeholder="Why?" maxLength={200} onChange={(event) => setReason(event.target.value)} />
      )}
      <button className="lf-btn lf-btn--sm" disabled={busy}>
        Move to {stage.name}
      </button>
      <button type="button" className="lf-btn lf-btn--ghost lf-btn--sm" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
