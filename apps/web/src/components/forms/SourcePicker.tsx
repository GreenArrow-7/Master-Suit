'use client';

import Field from '@/components/forms/Field';

export interface SourceOption {
  id: string;
  /** Stable across renames: `referral` makes the lead form ask who referred it. */
  key: string;
  name: string;
  parentId: string | null;
}

/**
 * Source, then the sub-source under it (M4-03): two selects over the
 * workspace's catalogue, on the lead form and the lead page's edit. The
 * sub-source list follows the source; a source with none offers "—".
 */
export default function SourcePicker({
  sources,
  sourceId,
  subSourceId,
  onChange,
  idPrefix = '',
  error,
}: {
  sources: SourceOption[];
  sourceId: string;
  subSourceId: string;
  onChange: (sourceId: string, subSourceId: string) => void;
  idPrefix?: string;
  error?: string;
}) {
  const parents = sources.filter((s) => !s.parentId);
  const children = sources.filter((s) => s.parentId === sourceId);
  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--lf-space-3)' }}
    >
      <Field label="Source" htmlFor={`${idPrefix}sourceId`} error={error}>
        <select
          id={`${idPrefix}sourceId`}
          name="sourceId"
          className="lf-input"
          value={sourceId}
          onChange={(e) => onChange(e.target.value, '')}
        >
          <option value="">—</option>
          {parents.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Sub-source" htmlFor={`${idPrefix}subSourceId`}>
        {/* A disabled select showing "—" read as a broken control: testers
            reported the field as having no options rather than as not applying.
            It now says which of the two it is. */}
        {children.length === 0 ? (
          <span className="lf-empty-note" id={`${idPrefix}subSourceId`}>
            {sourceId ? 'No sub-sources configured for this source.' : 'Choose a source first.'}
          </span>
        ) : (
          <select
            id={`${idPrefix}subSourceId`}
            name="subSourceId"
            className="lf-input"
            value={subSourceId}
            onChange={(e) => onChange(sourceId, e.target.value)}
          >
            <option value="">—</option>
            {children.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </Field>
    </div>
  );
}
