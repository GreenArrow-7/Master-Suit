import DateInput from '@/components/forms/DateInput';
import { onDay } from '@/lib/leads/followUpDue';
import type { BoardFilter, BoardFilterOption, BoardFilterOptions, BoardRange } from '@/lib/leads/boardFilter';

const RANGE_LABELS: Record<BoardRange, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

/**
 * The board's filter bar (M3-16, M3-17), also the reports' (M16-12): a plain
 * GET form, so the choice is the URL. Folded behind a summary naming what is
 * applied, so it takes one line on a phone. `hidden` keeps the page's own
 * parameters (a report's key) across a submit.
 */
export default function BoardFilterBar({
  filter,
  options,
  hidden = {},
  clearHref = '?clear=1',
  idle = 'All time, everyone',
  noPeriod = 'All time, or these dates',
}: {
  filter: BoardFilter;
  options: BoardFilterOptions;
  hidden?: Record<string, string>;
  clearHref?: string;
  /** The summary when nothing is applied. */
  idle?: string;
  /** The period list's first choice: no preset. */
  noPeriod?: string;
}) {
  const named = (list: BoardFilterOption[], id?: string) => list.find((item) => item.id === id)?.name;
  const short = { day: '2-digit', month: 'short' } as const;
  const applied = [
    filter.range
      ? RANGE_LABELS[filter.range]
      : filter.from && filter.to
        ? `${onDay(filter.from, short)} – ${onDay(filter.to, short)}`
        : undefined,
    named(options.people, filter.owner),
    named(options.teams, filter.team),
    named(options.sources, filter.source),
    named(options.projects, filter.project),
  ].filter(Boolean);
  const select = (name: 'owner' | 'team' | 'source' | 'project', label: string, list: BoardFilterOption[]) =>
    list.length > 0 && (
      <label className="lf-boardfilter__field">
        <span>{label}</span>
        <select className="lf-input" name={name} defaultValue={filter[name] ?? ''}>
          <option value="">All</option>
          {list.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <details className="lf-boardfilter">
      <summary>
        <span>Filters</span>
        <span className="lf-hint">{applied.length > 0 ? applied.join(' · ') : idle}</span>
      </summary>
      <form method="get" className="lf-boardfilter__body">
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label className="lf-boardfilter__field">
          <span>Period</span>
          <select className="lf-input" name="range" defaultValue={filter.range ?? ''}>
            <option value="">{noPeriod}</option>
            {Object.entries(RANGE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="lf-boardfilter__field">
          <span>From</span>
          <DateInput name="from" defaultValue={filter.from ?? ''} />
        </label>
        <label className="lf-boardfilter__field">
          <span>To</span>
          <DateInput name="to" defaultValue={filter.to ?? ''} />
        </label>
        {select('owner', 'Person', options.people)}
        {select('team', 'Team', options.teams)}
        {select('source', 'Source', options.sources)}
        {select('project', 'Project', options.projects)}
        <div className="lf-boardfilter__actions">
          <button type="submit" className="lf-btn lf-btn--sm">
            Apply
          </button>
          <a className="lf-btn lf-btn--secondary lf-btn--sm" href={clearHref}>
            Clear
          </a>
        </div>
      </form>
    </details>
  );
}
