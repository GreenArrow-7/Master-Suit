'use client';

import { useId, useState } from 'react';
import Badge from '@/components/ui/Badge';
import Field from '@/components/forms/Field';
import { send, useRun } from '@/components/forms/useRun';

interface Template {
  id: string;
  name: string;
  subject: string;
  body: string;
  isActive: boolean;
}

const API = '/api/v1/email-templates';

/** Each template as a card that edits in place, and a card for a new one. */
export default function EmailTemplateEditor({ canEdit, templates }: { canEdit: boolean; templates: Template[] }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
      {templates.length === 0 && !canEdit && (
        <p className="lf-card" style={{ padding: 'var(--lf-space-4)', margin: 0 }}>
          No email templates yet.
        </p>
      )}
      {templates.map((template) => (
        <TemplateForm key={template.id} template={template} canEdit={canEdit} />
      ))}
      {canEdit && <TemplateForm canEdit />}
    </div>
  );
}

function TemplateForm({ template, canEdit }: { template?: Template; canEdit: boolean }) {
  const id = useId();
  const { busy, run, note } = useRun();
  const [name, setName] = useState(template?.name ?? '');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const dirty =
    !template ||
    name !== template.name ||
    subject !== template.subject ||
    body !== template.body ||
    isActive !== template.isActive;
  const label = template ? `Template ${template.name}` : 'New email template';

  return (
    <form
      className="lf-card"
      aria-label={label}
      style={{ padding: 'var(--lf-space-4)', display: 'grid', gap: 'var(--lf-space-3)', minWidth: 0 }}
      onSubmit={(e) => {
        e.preventDefault();
        const fields = { name: name.trim(), subject: subject.trim(), body: body.trim() };
        void run(
          async () => {
            if (template) await send(`${API}?id=${template.id}`, 'PATCH', { ...fields, isActive });
            else {
              await send(API, 'POST', fields);
              setName('');
              setSubject('');
              setBody('');
            }
          },
          template ? 'Saved.' : 'Added.',
        );
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ flex: '1 1 auto' }}>{template ? template.name : 'New email template'}</strong>
        {template && !template.isActive && <Badge tone="slate">Archived</Badge>}
      </div>
      <Field label="Name" htmlFor={`${id}-name`} required>
        <input
          id={`${id}-name`}
          className="lf-input"
          required
          maxLength={120}
          readOnly={!canEdit}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Subject" htmlFor={`${id}-subject`} required>
        <input
          id={`${id}-subject`}
          className="lf-input"
          required
          maxLength={200}
          readOnly={!canEdit}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </Field>
      <Field label="Body" htmlFor={`${id}-body`} required>
        <textarea
          id={`${id}-body`}
          className="lf-textarea"
          required
          rows={6}
          maxLength={20_000}
          readOnly={!canEdit}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {template && (
            <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Offered when sending
            </label>
          )}
          <button
            className="lf-btn lf-btn--sm"
            disabled={busy || !dirty || !name.trim() || !subject.trim() || !body.trim()}
          >
            {template ? 'Save' : 'Add template'}
          </button>
        </div>
      )}
      {note}
    </form>
  );
}
