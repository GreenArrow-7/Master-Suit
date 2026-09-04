'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildWorkspaceNav, searchTargets, type NavInput } from '@/lib/nav/workspaceNav';

/**
 * ⌘K. Jump to any page you may open, or search a list by name.
 *
 * The badge on the top bar promised this for a long time while the shortcut
 * only focused a box wired to Leads. This is the real thing, and it is
 * deliberately built on what exists: the pages come from the same navigation
 * model the sidebar renders (so it can never offer a page the rail would not),
 * and "Search leads for …" sends the query to the list that already filters
 * by `?q=`. There is no cross-entity search backend and this does not pretend
 * there is one.
 *
 * Opens on ⌘K / Ctrl+K, or on the `lf:cmdk` event the top bar's trigger fires.
 */

interface Result {
  key: string;
  group: string;
  label: string;
  href: string;
  hint?: string;
}

const MAX_PAGES = 9;

export default function CommandPalette({ slug, modules, permitted, serviceMode = false }: NavInput) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const pages = useMemo(
    () =>
      buildWorkspaceNav({ slug, modules, permitted, serviceMode }).flatMap((group) =>
        group.items.map((item) => ({
          key: item.href,
          group: group.label.replace('More · ', ''),
          label: item.label,
          href: item.href,
          haystack: `${item.label} ${item.keywords ?? ''} ${group.label}`.toLowerCase(),
        })),
      ),
    [slug, modules, permitted, serviceMode],
  );
  const targets = useMemo(() => searchTargets({ slug, modules, permitted }), [slug, modules, permitted]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const matched = (q ? pages.filter((page) => words.every((w) => page.haystack.includes(w))) : pages).slice(
      0,
      MAX_PAGES,
    );
    const pageResults: Result[] = matched.map(({ key, group, label, href }) => ({ key, group, label, href }));
    if (!q) return pageResults;
    const searches: Result[] = targets.map((t) => ({
      key: `search:${t.label}`,
      group: 'Search',
      label: `Search ${t.label} for “${query.trim()}”`,
      href: `${t.href}?q=${encodeURIComponent(query.trim())}`,
      hint: 'Enter',
    }));
    return [...pageResults, ...searches];
  }, [query, pages, targets]);

  // Opening resets the query and the cursor here, in the handler, rather than
  // in an effect that sets state on mount — which is the cascade the compiler
  // lint refuses.
  const show = () => {
    setQuery('');
    setCursor(0);
    setOpen(true);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => {
          if (!value) {
            setQuery('');
            setCursor(0);
          }
          return !value;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('lf:cmdk', show);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('lf:cmdk', show);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    // The input mounts with the panel; focus after paint.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(id);
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  const go = (result: Result | undefined) => {
    if (!result) return;
    setOpen(false);
    router.push(result.href);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(results[cursor]);
    }
  };

  return (
    <>
      <div className="lf-cmdk__scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="lf-cmdk" role="dialog" aria-modal="true" aria-label="Search and commands" onKeyDown={onKeyDown}>
        <div className="lf-cmdk__field">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            className="lf-cmdk__input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            placeholder="Jump to a page, or search leads, employees…"
            aria-label="Jump to a page or search"
            role="combobox"
            aria-expanded="true"
            aria-controls="lf-cmdk-list"
            aria-activedescendant={results[cursor] ? `lf-cmdk-${cursor}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>esc</kbd>
        </div>
        <div className="lf-cmdk__list" id="lf-cmdk-list" role="listbox" ref={listRef}>
          {results.length === 0 && <div className="lf-cmdk__empty">Nothing matches “{query}”.</div>}
          {results.map((result, index) => (
            <div key={result.key}>
              {results[index - 1]?.group !== result.group && <div className="lf-cmdk__group">{result.group}</div>}
              <div
                id={`lf-cmdk-${index}`}
                role="option"
                aria-selected={index === cursor}
                className="lf-cmdk__item"
                onMouseEnter={() => setCursor(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(result)}
              >
                <span>{result.label}</span>
                {result.hint && <kbd>{result.hint}</kbd>}
              </div>
            </div>
          ))}
        </div>
        <div className="lf-cmdk__foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>⌘K</kbd> toggle
          </span>
        </div>
      </div>
    </>
  );
}
