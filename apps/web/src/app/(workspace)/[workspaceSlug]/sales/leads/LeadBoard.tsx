'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SalesLink from '@/components/workspace/SalesLink';
import StageReason, { asksBeforeMove, type ReasonedStage, type StageMove } from '@/components/workspace/StageReason';

export interface BoardCard {
  id: string;
  reference: string;
  fullName: string;
  owner: string | null;
}

export interface BoardColumn {
  stage: ReasonedStage & { key: string; category: string };
  /** A lost or junk stage: drawn after the ladder, in its own group. */
  exit: boolean;
  /** Every lead of the list in this stage; `rows` is the first page of them. */
  count: number;
  rows: BoardCard[];
  /** The list of this stage, when the column holds more than it shows. */
  moreHref: string | null;
}

/**
 * The lead list as a board (M4-21): a column per stage. A card moves by drag,
 * or by its Move menu (the keyboard's and the phone's way), through the lead
 * page's own `PATCH /api/v1/leads/{id}`. A stage that asks for a reason or
 * books a visit or a meeting opens the same mini-form first (`StageReason`),
 * and the server refuses the move without it.
 */
export default function LeadBoard({
  columns,
  projects,
  canEdit,
}: {
  columns: BoardColumn[];
  /** The mini-form's site visit picker (bookableProjects). */
  projects: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [over, setOver] = useState<string | null>(null);
  /** The card and stage waiting on the mini-form. */
  const [pending, setPending] = useState<{ card: BoardCard; stage: ReasonedStage } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(card: BoardCard, stageId: string, move: StageMove = {}) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/leads/${card.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stageId, ...move }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const data = res ? await res.json().catch(() => ({})) : {};
      const why = typeof data.detail === 'string' ? data.detail : res ? `Request failed (${res.status}).` : null;
      setError(`${card.fullName} was not moved. ${why ?? 'Could not reach the server.'}`);
      return;
    }
    setPending(null);
    router.refresh();
  }

  function move(card: BoardCard, from: string, stageId: string) {
    const stage = columns.find((column) => column.stage.id === stageId)?.stage;
    if (!stage || stageId === from) return;
    setError(null);
    if (asksBeforeMove(stage)) setPending({ card, stage });
    else void send(card, stageId);
  }

  /** A dropped card, by the id its drag carries, and the column it left. */
  function dropped(cardId: string, stageId: string) {
    const from = columns.find((c) => c.rows.some((row) => row.id === cardId));
    const card = from?.rows.find((row) => row.id === cardId);
    if (from && card) move(card, from.stage.id, stageId);
  }

  const column = ({ stage, count, rows, moreHref }: BoardColumn) => (
    <section
      key={stage.id}
      className="lf-board__col"
      aria-label={stage.name}
      data-over={over === stage.id ? '' : undefined}
      onDragOver={(event) => {
        if (!canEdit) return;
        event.preventDefault();
        setOver(stage.id);
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(null);
        dropped(event.dataTransfer.getData('text/plain'), stage.id);
      }}
    >
      <header className="lf-board__head">
        <h2>{stage.name}</h2>
        <span className="lf-num">{count}</span>
      </header>
      <ul className="lf-board__cards">
        {rows.map((card) => (
          <li
            key={card.id}
            className="lf-board__card"
            draggable={canEdit}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', card.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
          >
            <SalesLink href={`/leads/${card.id}`} className="lf-board__name" draggable={false}>
              {card.fullName}
            </SalesLink>
            <span className="lf-board__meta">
              {card.reference} · {card.owner ?? 'Unassigned'}
            </span>
            {/* A disclosure of stage buttons, not a <select>: a closed select
                changes on an arrow key, and a change here is a move. */}
            {canEdit && (
              <details className="lf-board__move">
                <summary className="lf-btn lf-btn--secondary lf-btn--sm" aria-label={`Move ${card.fullName}`}>
                  Move to…
                </summary>
                <div className="lf-board__stages">
                  {columns
                    .filter((other) => other.stage.id !== stage.id)
                    .map((other) => (
                      <button
                        key={other.stage.id}
                        type="button"
                        className="lf-menu__item"
                        disabled={busy}
                        onClick={() => move(card, stage.id, other.stage.id)}
                      >
                        {other.stage.name}
                      </button>
                    ))}
                </div>
              </details>
            )}
          </li>
        ))}
      </ul>
      {count === 0 && <p className="lf-board__empty">No leads</p>}
      {moreHref && (
        <SalesLink href={moreHref} className="lf-board__more">
          {count - rows.length} more
        </SalesLink>
      )}
    </section>
  );

  const exits = columns.filter((c) => c.exit);
  return (
    <>
      {error && !pending && (
        <p className="lf-field__error" role="alert">
          {error}
        </p>
      )}
      {pending && (
        <StageReason
          stage={pending.stage}
          projects={projects}
          busy={busy}
          error={error}
          onMove={(stageMove) => void send(pending.card, pending.stage.id, stageMove)}
          onCancel={() => {
            setPending(null);
            setError(null);
          }}
        />
      )}
      <div className="lf-board">
        {columns.filter((c) => !c.exit).map(column)}
        {exits.length > 0 && (
          <div className="lf-board__exits" role="group" aria-label="Exits">
            {exits.map(column)}
          </div>
        )}
      </div>
    </>
  );
}
