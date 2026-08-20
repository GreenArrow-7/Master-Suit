'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * The messaging workspace: threads, the current conversation, and who the
 * customer is (§25–§29).
 *
 * On desktop it is three columns. On a phone it is one column at a time —
 * list, then thread, then the customer as a drawer — because §71 is right that
 * squeezing three columns into 390px produces something nobody can use. The
 * composer stays reachable in both.
 */

interface LastMessage {
  body: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  createdAt: string;
  status: string;
}

interface Conversation {
  id: string;
  channel: string;
  externalId: string;
  displayName: string | null;
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
  ownerId: string | null;
  owner: { id: string; fullName: string | null } | null;
  lead: { id: string; reference: string; fullName: string } | null;
  lastMessage: LastMessage | null;
}

interface Message {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  status: string;
  body: string | null;
  createdAt: string;
  errorMessage: string | null;
}

interface Template {
  key: string;
  name: string;
  body: string;
  language: string;
  mergeFields: string[];
}

interface WindowState {
  open: boolean;
  lastInboundAt: string | null;
  reason: string | null;
}

const FILTERS = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['mine', 'Mine'],
  ['unassigned', 'Unassigned'],
  ['archived', 'Archived'],
] as const;

type Filter = (typeof FILTERS)[number][0];

/**
 * Delivery state as words, not only as colour.
 *
 * §73: colour alone cannot carry status. Each state has its own glyph and its
 * own label, and the label is what a screen reader announces.
 */
const DELIVERY: Record<string, { mark: string; label: string }> = {
  QUEUED: { mark: '○', label: 'Queued' },
  SENDING: { mark: '○', label: 'Sending' },
  SENT: { mark: '✓', label: 'Sent' },
  DELIVERED: { mark: '✓✓', label: 'Delivered' },
  READ: { mark: '✓✓', label: 'Read' },
  FAILED: { mark: '⚠', label: 'Failed' },
};

export default function ConversationInbox({ workspaceSlug, canSend }: { workspaceSlug: string; canSend: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [windowState, setWindowState] = useState<WindowState | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [showContext, setShowContext] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateKey, setTemplateKey] = useState('');
  const [variables, setVariables] = useState<string[]>([]);

  const threadRef = useRef<HTMLDivElement>(null);

  const active = useMemo(() => conversations.find((c) => c.id === activeId) ?? null, [conversations, activeId]);

  const loadList = useCallback((signal?: AbortSignal) => {
    const query = new URLSearchParams({ filter });
    if (search.trim()) query.set('search', search.trim());
    return fetch(`/api/v1/conversations?${query}`, { headers: { accept: 'application/json' }, signal })
      .then((res) => {
        if (!res.ok) throw new Error('Could not load conversations.');
        return res.json();
      })
      .then((data) => setConversations(data.conversations ?? []))
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      // An abort means a newer keystroke is already queued, so the spinner must
      // stay up — clearing it here flickered the list back to "loaded" between
      // characters.
      .finally(() => {
        if (!signal?.aborted) setLoadingList(false);
      });
  }, [filter, search]);

  /**
   * These effects fetch and nothing else, as promise chains rather than
   * async/await.
   *
   * Setting state synchronously inside an effect triggers a cascading render,
   * and the React Compiler counts an awaited body as synchronous — so `await
   * fetch(...)` followed by setState is flagged even though it plainly is not.
   * State set inside a `.then()` is a callback from an external system, which is
   * what effects are for. TopBar fetches the same way for the same reason.
   *
   * The spinner and the thread reset moved to the controls that trigger them,
   * which is where the interaction happens and where the user is already
   * waiting — the note in WorkspaceSidebar makes the same point.
   */
  useEffect(() => {
    // Debounced, because `search` updates per keystroke: without this each key
    // was its own request, and a slow older response could land after — and
    // overwrite — a newer one. The abort covers both. Same pattern as
    // NewCallForm's lead typeahead.
    const controller = new AbortController();
    const timer = setTimeout(() => void loadList(controller.signal), 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [loadList]);

  const loadThread = useCallback((id: string) => {
    return fetch(`/api/v1/conversations/${id}/messages`, { headers: { accept: 'application/json' } })
      .then((res) => {
        if (!res.ok) throw new Error('Could not open that conversation.');
        return res.json();
      })
      .then((data) => {
        setMessages(data.messages ?? []);
        setWindowState(data.window ?? null);
        // Opening a thread clears its unread badge server-side; mirror it here
        // rather than refetching the whole list for one number.
        setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (activeId) void loadThread(activeId);
  }, [activeId, loadThread]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  /**
   * Approved templates, fetched only once the window has actually closed.
   *
   * Inside the window a free-form reply is the right answer and a template list
   * is noise; outside it, it is the only answer — which is why the composer
   * cannot simply be disabled with an apology (§31).
   */
  useEffect(() => {
    if (!canSend || windowState?.open !== false) return;
    // Templates change rarely; the first closed-window thread loads them and
    // every later open→closed transition reuses that list.
    if (templates.length > 0) return;
    void fetch('/api/v1/whatsapp/templates', { headers: { accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : { templates: [] }))
      .then((data) => setTemplates(data.templates ?? []))
      .catch(() => setTemplates([]));
  }, [canSend, windowState?.open, templates.length]);

  const chosen = useMemo(() => templates.find((t) => t.key === templateKey) ?? null, [templates, templateKey]);

  /** What the customer will actually receive, placeholders filled in. */
  const fill = (text: string, values: string[]) =>
    text.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, token) => {
      const index = Number(token);
      return Number.isInteger(index) && index >= 1 ? values[index - 1] || match : match;
    });

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const usingTemplate = windowState?.open === false;
    if (!activeId || sending) return;
    if (usingTemplate ? !templateKey : !draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/conversations/${activeId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(usingTemplate ? { templateKey, variables } : { body: draft.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? data?.error ?? 'The message could not be sent.');
      setDraft('');
      setTemplateKey('');
      setVariables([]);
      await loadThread(activeId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="lf-inbox" data-thread-open={activeId ? 'true' : 'false'}>
      {/* ── Conversations ─────────────────────────────────────────────── */}
      <aside className="lf-inbox__list" aria-label="Conversations">
        <div className="lf-inbox__listhead">
          <label className="lf-visually-hidden" htmlFor="inbox-search">
            Search conversations
          </label>
          <input
            id="inbox-search"
            className="lf-input"
            type="search"
            placeholder="Search name or number…"
            value={search}
            onChange={(e) => {
              setLoadingList(true);
              setSearch(e.target.value);
            }}
          />
          <div className="lf-inbox__filters" role="tablist" aria-label="Filter conversations">
            {FILTERS.map(([key, label]) => (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={filter === key}
                className="lf-inbox__filter"
                onClick={() => {
                  setLoadingList(true);
                  setFilter(key);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="lf-inbox__threads">
          {loadingList && <p className="lf-inbox__muted">Loading…</p>}
          {!loadingList && conversations.length === 0 && (
            <div className="lf-empty">
              <p>No conversations here yet.</p>
              <p className="lf-inbox__muted">
                WhatsApp messages appear the moment a customer writes to your connected number.
              </p>
            </div>
          )}
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              className="lf-inbox__thread"
              aria-current={conversation.id === activeId}
              onClick={() => {
                setMessages([]);
                setError(null);
                setActiveId(conversation.id);
                setShowContext(false);
              }}
            >
              <span className="lf-inbox__threadtop">
                <span className="lf-inbox__name">
                  {conversation.lead?.fullName ?? conversation.displayName ?? conversation.externalId}
                </span>
                <time className="lf-inbox__time" dateTime={conversation.lastMessageAt ?? undefined}>
                  {relative(conversation.lastMessageAt)}
                </time>
              </span>
              <span className="lf-inbox__preview">
                {conversation.lastMessage?.direction === 'OUTBOUND' && <span aria-hidden="true">↩ </span>}
                {conversation.lastMessage?.body ?? 'No messages yet'}
              </span>
              <span className="lf-inbox__meta">
                {/* An unlinked thread is §29's state, and says so in words. */}
                {!conversation.lead && <span className="lf-badge">New contact</span>}
                {!conversation.ownerId && <span className="lf-badge">Unassigned</span>}
                {conversation.owner?.fullName && <span className="lf-inbox__muted">{conversation.owner.fullName}</span>}
                {conversation.unreadCount > 0 && (
                  <span className="lf-inbox__unread">
                    {conversation.unreadCount}
                    <span className="lf-visually-hidden"> unread messages</span>
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* ── Conversation ──────────────────────────────────────────────── */}
      <section className="lf-inbox__thread-pane" aria-label="Conversation">
        {!active && <div className="lf-empty">Choose a conversation to read it.</div>}
        {active && (
          <>
            <header className="lf-inbox__threadhead">
              <button
                type="button"
                className="lf-btn lf-btn--ghost lf-btn--sm lf-inbox__back"
                onClick={() => setActiveId(null)}
              >
                ← Conversations
              </button>
              <div>
                <h2 className="lf-inbox__title">{active.lead?.fullName ?? active.displayName ?? active.externalId}</h2>
                <p className="lf-inbox__muted">{active.externalId}</p>
              </div>
              <button
                type="button"
                className="lf-btn lf-btn--secondary lf-btn--sm lf-inbox__ctxtoggle"
                aria-expanded={showContext}
                onClick={() => setShowContext((open) => !open)}
              >
                Customer
              </button>
            </header>

            <div className="lf-inbox__messages" ref={threadRef} role="log" aria-live="polite" aria-label="Messages">
              {messages.map((message) => {
                const delivery = DELIVERY[message.status] ?? DELIVERY.QUEUED!;
                return (
                  <article
                    key={message.id}
                    className="lf-msg"
                    data-direction={message.direction}
                    data-failed={message.status === 'FAILED' ? 'true' : undefined}
                  >
                    <p className="lf-msg__body">{message.body}</p>
                    <p className="lf-msg__foot">
                      <time dateTime={message.createdAt}>{clock(message.createdAt)}</time>
                      {message.direction === 'OUTBOUND' && (
                        <span className="lf-msg__status">
                          <span aria-hidden="true">{delivery.mark}</span>
                          {/* The word, not just the tick — §73. */}
                          <span className="lf-msg__statuslabel">{delivery.label}</span>
                        </span>
                      )}
                    </p>
                    {message.errorMessage && <p className="lf-msg__error">{message.errorMessage}</p>}
                  </article>
                );
              })}
            </div>

            {error && (
              <p className="lf-inbox__error" role="alert">
                {error}
              </p>
            )}

            {canSend ? (
              <form className="lf-inbox__composer" onSubmit={send}>
                {windowState?.open !== false ? (
                  <>
                    <label className="lf-visually-hidden" htmlFor="inbox-reply">
                      Your reply
                    </label>
                    <textarea
                      id="inbox-reply"
                      className="lf-input"
                      rows={2}
                      value={draft}
                      disabled={sending}
                      placeholder="Write a reply..."
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        // Enter sends, Shift+Enter breaks the line - and the
                        // button is still there for anyone who does not want a
                        // keystroke to message a customer.
                        if (e.key === 'Enter' && !e.shiftKey) void send(e);
                      }}
                    />
                    <button className="lf-btn" type="submit" disabled={sending || !draft.trim()}>
                      {sending ? 'Sending...' : 'Send'}
                    </button>
                  </>
                ) : (
                  <>
                    {/* §32. The window has lapsed, so a template is not a
                        fallback - it is the only legal way to write, and
                        offering the list is the difference between a closed
                        composer and a dead end. */}
                    <p className="lf-inbox__notice" role="status">
                      {windowState.reason}
                    </p>
                    <label className="lf-visually-hidden" htmlFor="inbox-template">
                      Approved template
                    </label>
                    <select
                      id="inbox-template"
                      className="lf-input"
                      value={templateKey}
                      disabled={sending}
                      onChange={(e) => {
                        setTemplateKey(e.target.value);
                        const next = templates.find((t) => t.key === e.target.value);
                        setVariables(next ? next.mergeFields.map(() => '') : []);
                      }}
                    >
                      <option value="">
                        {templates.length ? 'Choose an approved template...' : 'No approved templates yet'}
                      </option>
                      {templates.map((template) => (
                        <option key={template.key} value={template.key}>
                          {template.name} ({template.language})
                        </option>
                      ))}
                    </select>
                    <button className="lf-btn" type="submit" disabled={sending || !templateKey}>
                      {sending ? 'Sending...' : 'Send template'}
                    </button>
                    {chosen && (
                      <div className="lf-inbox__template">
                        {chosen.mergeFields.map((field, index) => (
                          <span key={field} className="lf-inbox__var">
                            <label className="lf-visually-hidden" htmlFor={`var-${field}`}>
                              Value for placeholder {field}
                            </label>
                            <input
                              id={`var-${field}`}
                              className="lf-input"
                              placeholder={`{{${field}}}`}
                              value={variables[index] ?? ''}
                              onChange={(e) =>
                                setVariables((prev) => {
                                  const next = [...prev];
                                  next[index] = e.target.value;
                                  return next;
                                })
                              }
                            />
                          </span>
                        ))}
                        <p className="lf-inbox__preview-text">{fill(chosen.body, variables)}</p>
                      </div>
                    )}
                  </>
                )}
              </form>
            ) : (
              <p className="lf-inbox__notice">You have read access to this conversation but cannot reply.</p>
            )}
          </>
        )}
      </section>

      {/* ── Customer (§28) ────────────────────────────────────────────── */}
      <aside className="lf-inbox__context" data-open={showContext ? 'true' : 'false'} aria-label="Customer">
        {active ? (
          <>
            <h2 className="lf-inbox__title">Customer</h2>
            {active.lead ? (
              <dl className="lf-inbox__facts">
                <dt>Name</dt>
                <dd>{active.lead.fullName}</dd>
                <dt>Reference</dt>
                <dd>
                  <a href={`/${workspaceSlug}/sales/leads/${active.lead.id}`}>{active.lead.reference}</a>
                </dd>
                <dt>Owner</dt>
                <dd>{active.owner?.fullName ?? 'Unassigned'}</dd>
              </dl>
            ) : (
              <div className="lf-empty">
                <p>New WhatsApp contact</p>
                <p className="lf-inbox__muted">
                  This number is not linked to anyone yet. Nothing was created automatically — a wrong number should not
                  become a customer.
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="lf-inbox__muted">Open a conversation to see who it is with.</p>
        )}
      </aside>
    </div>
  );
}

/** Times are the customer's most-read column; keep them short and absolute-ish. */
function relative(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  return new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short' });
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });
