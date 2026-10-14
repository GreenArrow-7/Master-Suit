import Field from '@/components/forms/Field';
import DateInput from '@/components/forms/DateInput';
import SalesLink from '@/components/workspace/SalesLink';
import { leadListHref, type LeadListParams } from '@/services/leads/leadList';

const SORTS = [
  ['updated', 'Last updated'],
  ['created', 'Newest first'],
  ['score', 'Highest score'],
  ['name', 'Name A–Z'],
] as const;

const DATE_LABEL = { created: 'Created', updated: 'Updated', contacted: 'First contacted' } as const;

/**
 * The lead grid's filter chips (M4-19): stage, owner, source and a created or
 * updated date range, and the sort. A plain GET form, so the choice is the URL
 * and every link and saved view carries it; each chip in force shows beside it
 * with a link that drops it. The options are what the viewer may choose from:
 * the workspace's stages, the people whose leads they read, the source
 * catalogue (a source takes its sub-sources with it, `leadListQuery`).
 */
export default function LeadFilters({
  params,
  stages,
  owners,
  sources,
}: {
  params: LeadListParams;
  stages: { id: string; name: string }[];
  owners: { id: string; fullName: string }[];
  sources: { id: string; name: string; parentId: string | null }[];
}) {
  const sourceName = (id: string) => {
    const entry = sources.find((source) => source.id === id);
    const parent = entry?.parentId ? sources.find((source) => source.id === entry.parentId) : null;
    return entry ? [parent?.name, entry.name].filter(Boolean).join(' · ') : 'Unknown source';
  };
  const sourceOptions = sources
    .filter((source) => !source.parentId)
    .flatMap((source) => [source, ...sources.filter((child) => child.parentId === source.id)]);
  const range = [params.from, params.to].map((day) => day?.split('-').reverse().join('/') ?? '…').join(' – ');

  const chips: [label: string, drop: (keyof LeadListParams)[]][] = [];
  if (params.stage) chips.push([`Stage: ${stages.find((s) => s.id === params.stage)?.name ?? 'Unknown'}`, ['stage']]);
  if (params.owner) {
    const owner = params.owner === 'none' ? 'Unassigned' : owners.find((o) => o.id === params.owner)?.fullName;
    chips.push([`Owner: ${owner ?? 'Someone else'}`, ['owner']]);
  }
  if (params.source) chips.push([`Source: ${sourceName(params.source)}`, ['source']]);
  if (params.from || params.to)
    chips.push([`${DATE_LABEL[params.date ?? 'created']}: ${range}`, ['date', 'from', 'to']]);
  const without = (keys: (keyof LeadListParams)[]) =>
    leadListHref({ ...params, ...Object.fromEntries(keys.map((key) => [key, undefined])) });

  return (
    <>
      <details className="lf-lead-filters">
        <summary className="lf-btn lf-btn--secondary lf-btn--sm">
          Filters{chips.length ? ` · ${chips.length}` : ''}
        </summary>
        <form method="get" className="lf-lead-filters__form">
          {(['filter', 'q', 'cols', 'layout'] as const).map(
            (key) => params[key] && <input key={key} type="hidden" name={key} value={params[key]} />,
          )}
          <Field label="Stage" htmlFor="lf-filter-stage">
            <select id="lf-filter-stage" name="stage" className="lf-input" defaultValue={params.stage ?? ''}>
              <option value="">Any stage</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Owner" htmlFor="lf-filter-owner">
            <select id="lf-filter-owner" name="owner" className="lf-input" defaultValue={params.owner ?? ''}>
              <option value="">Anyone</option>
              <option value="none">Unassigned</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Source" htmlFor="lf-filter-source">
            <select id="lf-filter-source" name="source" className="lf-input" defaultValue={params.source ?? ''}>
              <option value="">Any source</option>
              {sourceOptions.map((source) => (
                <option key={source.id} value={source.id}>
                  {sourceName(source.id)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date" htmlFor="lf-filter-date">
            <select id="lf-filter-date" name="date" className="lf-input" defaultValue={params.date ?? 'created'}>
              <option value="created">Created</option>
              <option value="updated">Updated</option>
              <option value="contacted">First contacted</option>
            </select>
          </Field>
          <Field label="From" htmlFor="lf-filter-from">
            <DateInput id="lf-filter-from" name="from" defaultValue={params.from} />
          </Field>
          <Field label="To" htmlFor="lf-filter-to">
            <DateInput id="lf-filter-to" name="to" defaultValue={params.to} />
          </Field>
          <Field label="Sort" htmlFor="lf-filter-sort">
            <select id="lf-filter-sort" name="sort" className="lf-input" defaultValue={params.sort ?? 'updated'}>
              {SORTS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <button className="lf-btn lf-btn--sm">Apply</button>
        </form>
      </details>
      {chips.length > 0 && (
        <nav className="lf-chips" aria-label="Filters in force">
          {chips.map(([label, drop]) => (
            <SalesLink
              key={label}
              className="lf-chip"
              aria-current="true"
              href={without(drop)}
              title={`Remove ${label}`}
            >
              {label}
              <span aria-hidden="true">×</span>
              <span className="lf-visually-hidden"> (remove)</span>
            </SalesLink>
          ))}
        </nav>
      )}
    </>
  );
}
