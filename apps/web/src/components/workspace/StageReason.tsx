'use client';

import { useEffect, useId, useRef } from 'react';
import Field from '@/components/forms/Field';
import { DateTimeInput } from '@/components/forms/DateInput';

/**
 * What a stage asks for when a lead enters it (LeadStage.requiresReason,
 * reasons, and in requiredFields what it books: lib/leads/stageBookings.ts).
 */
export interface ReasonedStage {
  id: string;
  name: string;
  requiresReason: boolean;
  reasons: string[];
  requiredFields: string[];
}

/** What the move sends beside the stage: a reason, and what the stage books. */
export type StageMove = Partial<Record<'stageReason' | 'visitAt' | 'projectId' | 'meetingAt', string>>;

const asksReason = (stage: ReasonedStage) => stage.requiresReason || stage.reasons.length > 0;

/** True when moving a lead to `stage` goes through this form first. */
export const asksBeforeMove = (stage: ReasonedStage) =>
  asksReason(stage) || stage.requiredFields.includes('visitAt') || stage.requiredFields.includes('meetingAt');

/**
 * The status mini-form (M4-18), one dialog for the lead page and the grid's bulk
 * move: the reason, or sub-status — a list when the stage has one, otherwise a
 * sentence, optional unless the stage requires it — and what the stage books:
 * the site visit's date, time and project, the meeting's date and time, on the
 * workspace's clock. The server checks the same rule and books in the same
 * request, so this only saves the round trip.
 */
export default function StageReason({
  stage,
  projects,
  busy,
  error,
  onMove,
  onCancel,
}: {
  stage: ReasonedStage;
  /** The site visit's picker: the projects the caller's catalogue holds. */
  projects: { id: string; name: string }[];
  busy: boolean;
  /** The server's refusal of the last try, shown here rather than behind the dialog. */
  error?: string | null;
  onMove: (move: StageMove) => void;
  onCancel: () => void;
}) {
  const id = useId();
  // The browser's modal dialog: the top layer, above the shell; focus moves in,
  // the page behind is inert, and Escape cancels.
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  const reason = { id: `${id}-reason`, name: 'stageReason', className: 'lf-input', required: stage.requiresReason };

  return (
    <dialog
      ref={dialog}
      className="lf-drawer"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <div className="lf-drawer__scrim" onClick={onCancel} />
      <form
        className="lf-drawer__panel"
        onSubmit={(event) => {
          event.preventDefault();
          const move: StageMove = {};
          for (const [key, value] of new FormData(event.currentTarget)) {
            if (String(value).trim()) move[key as keyof StageMove] = String(value).trim();
          }
          onMove(move);
        }}
      >
        <header className="lf-drawer__head">
          <h2 id={`${id}-title`}>Move to {stage.name}</h2>
        </header>
        <div className="lf-drawer__body">
          {error && (
            <p className="lf-field__error" role="alert">
              {error}
            </p>
          )}
          {asksReason(stage) && (
            <Field
              label={stage.requiresReason ? 'Why is it moving?' : 'Reason (optional)'}
              htmlFor={reason.id}
              required={stage.requiresReason}
            >
              {stage.reasons.length ? (
                <select {...reason} defaultValue="">
                  <option value="">{stage.requiresReason ? 'Choose a reason…' : 'No reason'}</option>
                  {stage.reasons.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input {...reason} placeholder="Why?" maxLength={200} />
              )}
            </Field>
          )}
          {stage.requiredFields.includes('visitAt') && (
            <>
              <Field label="Visit date and time" htmlFor={`${id}-visit`} required>
                <DateTimeInput id={`${id}-visit`} name="visitAt" required aria-label="Visit date and time" />
              </Field>
              <Field label="Project" htmlFor={`${id}-project`} required>
                <select id={`${id}-project`} className="lf-input" name="projectId" required defaultValue="">
                  <option value="">{projects.length ? 'Choose a project…' : 'No projects you can see'}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {stage.requiredFields.includes('meetingAt') && (
            <Field label="Meeting date and time" htmlFor={`${id}-meeting`} required>
              <DateTimeInput id={`${id}-meeting`} name="meetingAt" required aria-label="Meeting date and time" />
            </Field>
          )}
        </div>
        <footer className="lf-drawer__foot">
          <button type="button" className="lf-btn lf-btn--ghost lf-btn--sm" onClick={onCancel}>
            Cancel
          </button>
          <button className="lf-btn lf-btn--sm" disabled={busy}>
            Move to {stage.name}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
