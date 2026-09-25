/**
 * The official YH mark, as vector.
 *
 * Traced from the supplied artwork: the Y's right arm sweeps into the H's
 * crossbar, the H's left stem is split above and below that sweep, and the
 * right stem is a tall slab with a raked top. One component rather than a copy
 * of the same SVG in the sidebar, the auth shell, the platform console and the
 * app bar — when the design team supplies path data, it is replaced once.
 *
 * Ink, not a gradient: the four strokes take `currentColor`, so the mark is
 * the ink of whatever it sits on, and one cyan element — a counter cut into the
 * Y's arm — is the product's entire cyan budget. Flat fills need no <defs>, so
 * two marks on one page can no longer collide on a gradient id. No plate
 * behind it — the glyph is the mark. The favicon at app/icon.svg is the one
 * standalone copy, and the only place these paths are repeated: a file served
 * to the browser as an icon cannot import a component.
 *
 * ponytail: hand-traced polygons, not the studio's Béziers. Swap the <path>
 * elements for the official path data and nothing else needs to change.
 */
export default function YouhanMark({
  size = 34,
  className,
  title,
}: {
  size?: number;
  className?: string;
  /** Pass only when the mark is the sole label for a control. */
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-40 -90 1440 1340"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <g fill="currentColor">
        {/* The Y, sweeping into the crossbar. */}
        <path d="M30 90 L240 90 L640 548 C680 585 720 570 760 570 L1010 570 L1010 740 L760 740 C640 740 570 705 510 636 Z" />
        {/* Left stem, above the sweep. */}
        <path d="M510 100 L735 100 L735 545 L510 320 Z" />
        {/* Left stem, below the sweep. */}
        <path d="M510 672 L735 758 L735 915 L510 1090 Z" />
        {/* Right stem. */}
        <path d="M1010 235 L1290 35 L1290 1085 L1010 1085 Z" />
      </g>
      {/* The counter: inset in the Y's arm, aligned to its rake. The one cyan
          element in the product — see tokens.css. */}
      <path d="M145 170 L265 170 L405 330 L286 330 Z" fill="#00d9f5" />
    </svg>
  );
}
