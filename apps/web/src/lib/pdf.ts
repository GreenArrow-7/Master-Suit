/**
 * A minimal PDF writer, for payslips and offer letters.
 *
 * Deliberately not a dependency. The realistic options were `pdfkit` (plus its
 * font machinery), `puppeteer` (a headless browser, ~300 MB, and a second
 * runtime to keep patched in a container that handles payroll data), or the
 * ~120 lines below. What these documents actually need is left-aligned text, a
 * rule, and a two-column table of numbers — that is a handful of PDF operators,
 * and PDF is a text format for documents this simple.
 *
 * What this deliberately does not do: images, embedded fonts, wrapping,
 * right-to-left text, or more than one page. It uses the base-14 Helvetica every
 * reader ships, so there is no font to embed and no licence to check.
 *
 * ponytail: single page, WinAnsi only. A payslip that overflows one page is
 * silently truncated, and an Arabic name renders as `?`. If either becomes real,
 * that is the point to take the dependency rather than grow this — see
 * `MAX_LINES`.
 */

/** A page holds about this many lines at 12pt with the margins below. */
const MAX_LINES = 46;
const PAGE_WIDTH = 595; // A4 at 72 dpi
const PAGE_HEIGHT = 842;
const MARGIN = 56;

export type PdfLine =
  | { kind: 'heading'; text: string }
  | { kind: 'subheading'; text: string }
  | { kind: 'text'; text: string }
  /** Label left, value right — the shape every row of a payslip has. */
  | { kind: 'row'; label: string; value: string }
  | { kind: 'rule' }
  | { kind: 'gap' };

/**
 * PDF strings are parenthesised, so the delimiters and the escape character
 * itself have to be escaped or the document will not open at all.
 *
 * Anything outside WinAnsi is replaced rather than emitted raw: a stray byte
 * produces a file readers reject, which is worse than a visibly wrong character.
 */
function pdfString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7e]/g, '?');
}

function contentStream(lines: PdfLine[]): string {
  const ops: string[] = [];
  let y = PAGE_HEIGHT - MARGIN;
  const right = PAGE_WIDTH - MARGIN;

  for (const line of lines.slice(0, MAX_LINES)) {
    switch (line.kind) {
      case 'heading':
        y -= 24;
        ops.push(`BT /F2 16 Tf ${MARGIN} ${y} Td (${pdfString(line.text)}) Tj ET`);
        break;
      case 'subheading':
        y -= 20;
        ops.push(`BT /F2 11 Tf ${MARGIN} ${y} Td (${pdfString(line.text)}) Tj ET`);
        break;
      case 'text':
        y -= 16;
        ops.push(`BT /F1 10 Tf ${MARGIN} ${y} Td (${pdfString(line.text)}) Tj ET`);
        break;
      case 'row': {
        y -= 16;
        ops.push(`BT /F1 10 Tf ${MARGIN} ${y} Td (${pdfString(line.label)}) Tj ET`);
        // Right-aligned by estimate: Helvetica averages about 0.5em, which is
        // close enough for a column of currency and needs no font metrics.
        const width = line.value.length * 5;
        ops.push(`BT /F1 10 Tf ${right - width} ${y} Td (${pdfString(line.value)}) Tj ET`);
        break;
      }
      case 'rule':
        y -= 10;
        ops.push(`0.75 w ${MARGIN} ${y} m ${right} ${y} l S`);
        break;
      case 'gap':
        y -= 12;
        break;
    }
  }
  return ops.join('\n');
}

/**
 * Assemble the document.
 *
 * The xref table records the byte offset of every object, so offsets are
 * accumulated as the body is built rather than computed afterwards — getting
 * one wrong produces a file that opens in some readers and not others, which is
 * the worst possible failure mode for a payslip.
 */
export function renderPdf(lines: PdfLine[], meta: { title: string } = { title: 'Document' }): Buffer {
  const stream = contentStream(lines);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title (${pdfString(meta.title)}) /Producer (Master SaaS HRMS) >>`,
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;

  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  // latin1 throughout: `pdfString` has already reduced the text to that range,
  // and the byte lengths in /Length and xref must match what is written.
  return Buffer.from(body + xref + trailer, 'latin1');
}
