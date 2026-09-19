/**
 * The midnight ground the brand sits on: a faint engineering grid and one soft
 * light from the corner the mark points at. Pure CSS behind a single element,
 * so it costs nothing to reuse behind a hero, a loading screen or an empty
 * state, and it is inert — nothing here animates.
 */
export default function BrandBackground({ className }: { className?: string }) {
  return <div className={['lf-brandbg', className ?? ''].join(' ').trim()} aria-hidden="true" />;
}
