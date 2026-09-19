import type { ModuleId } from './modules';

/**
 * One small line glyph per module, drawn in a 20×20 box, stroke 1.6. Kept in
 * the same file as the module list's ids so a module cannot exist without its
 * glyph. Inline SVG so it inherits `currentColor` inside the graphic.
 */
export default function ModuleIcon({ id }: { id: ModuleId }) {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {GLYPHS[id]}
    </g>
  );
}

const GLYPHS: Record<ModuleId, React.ReactNode> = {
  sales: (
    <>
      <path d="M3 5h14l-5.5 6.5V16l-3 1.5V11.5Z" />
    </>
  ),
  people: (
    <>
      <circle cx="7.5" cy="7" r="2.6" />
      <circle cx="13.5" cy="8.5" r="2.1" />
      <path d="M2.8 16.5c.5-3 2.4-4.5 4.7-4.5s4.2 1.5 4.7 4.5" />
      <path d="M13.2 12.6c2.1.1 3.6 1.4 4 3.9" />
    </>
  ),
  operations: (
    <>
      <path d="M4 5.5h12M4 10h12M4 14.5h7" />
      <circle cx="15.5" cy="14.5" r="1.6" />
    </>
  ),
  communication: (
    <>
      <path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3.8 3v-3H4A1.5 1.5 0 0 1 2.5 12V6A1.5 1.5 0 0 1 4 4.5Z" />
    </>
  ),
  automation: (
    <>
      <path d="M11 2.5 4.5 11h5l-.5 6.5L15.5 9h-5Z" />
    </>
  ),
  analytics: (
    <>
      <path d="M3.5 16.5h13M5.5 13V9M9.5 13V5M13.5 13v-3" />
    </>
  ),
  tasks: (
    <>
      <rect x="3.5" y="3.5" width="13" height="13" rx="3" />
      <path d="m6.8 10.2 2.2 2.2 4.4-4.6" />
    </>
  ),
  ai: (
    <>
      <path d="M10 2.8c.6 3.6 2.6 5.6 6.2 6.2-3.6.6-5.6 2.6-6.2 6.2-.6-3.6-2.6-5.6-6.2-6.2 3.6-.6 5.6-2.6 6.2-6.2Z" />
      <path d="M15.6 13.2c.3 1.4 1.1 2.2 2.5 2.5-1.4.3-2.2 1.1-2.5 2.5-.3-1.4-1.1-2.2-2.5-2.5 1.4-.3 2.2-1.1 2.5-2.5Z" />
    </>
  ),
};
