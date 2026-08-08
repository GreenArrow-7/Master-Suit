/**
 * The PDF writer.
 *
 * The failure mode that matters is a file no reader will open, and every way of
 * getting there is structural: a wrong /Length, a wrong xref offset, or an
 * unescaped parenthesis in a name. So these check the bytes rather than the
 * appearance — nothing here can tell you the payslip is pretty, only that it is
 * a valid document.
 */
import { describe, expect, it } from 'vitest';
import { renderPdf, type PdfLine } from '@/lib/pdf';

const parse = (pdf: Buffer) => pdf.toString('latin1');

describe('renderPdf', () => {
  const sample: PdfLine[] = [
    { kind: 'heading', text: 'Payslip' },
    { kind: 'text', text: 'March 2026' },
    { kind: 'rule' },
    { kind: 'row', label: 'Basic salary', value: 'AED 6,000.00' },
    { kind: 'gap' },
  ];

  it('produces a structurally complete document', () => {
    const text = parse(renderPdf(sample));
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Type /Page');
    expect(text).toContain('trailer');
  });

  it('records an xref offset that actually points at each object', () => {
    // The bug this catches opens in one reader and not another, which is the
    // worst possible failure for a payslip somebody has to show a bank.
    const pdf = renderPdf(sample);
    const text = parse(pdf);
    const xref = text.slice(text.indexOf('xref\n'));
    const offsets = [...xref.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    expect(offsets.length).toBeGreaterThan(4);

    offsets.forEach((offset, index) => {
      expect(text.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj`));
    });
  });

  it('declares a stream length matching the bytes written', () => {
    const text = parse(renderPdf(sample));
    const declared = Number(/<< \/Length (\d+) >>/.exec(text)![1]);
    const body = text.slice(text.indexOf('stream\n') + 'stream\n'.length, text.indexOf('\nendstream'));
    expect(Buffer.byteLength(body, 'latin1')).toBe(declared);
  });

  it('escapes the delimiters that would otherwise corrupt the file', () => {
    // A surname with a bracket in it is not exotic, and unescaped it ends the
    // string operator early and breaks the whole content stream.
    const text = parse(renderPdf([{ kind: 'text', text: 'Ali (Abu) \\ Rahman' }]));
    expect(text).toContain('(Ali \\(Abu\\) \\\\ Rahman)');
  });

  it('replaces characters it cannot encode rather than emitting raw bytes', () => {
    const text = parse(renderPdf([{ kind: 'text', text: 'محمد' }]));
    // Documented limitation: WinAnsi only. Wrong on screen beats a file that
    // will not open, and the ponytail note in the module says when to fix it.
    expect(text).toContain('(????)');
  });

  it('truncates rather than overflowing off the page', () => {
    const many: PdfLine[] = Array.from({ length: 200 }, (_, index) => ({ kind: 'text', text: `Line ${index}` }));
    const text = parse(renderPdf(many));
    expect(text).toContain('(Line 10)');
    expect(text).not.toContain('(Line 190)');
  });
});
