import { describe, expect, it } from 'vitest';
import { smsParts } from '@/lib/sms';

/** The composer's count (M4-29): GSM 160 then 153 a part, extension characters two; UCS-2 70 then 67. */
describe('smsParts', () => {
  it('counts the GSM alphabet', () => {
    expect(smsParts('')).toEqual({ parts: 0, perPart: 160, unicode: false });
    expect(smsParts('a'.repeat(160))).toEqual({ parts: 1, perPart: 160, unicode: false });
    expect(smsParts('a'.repeat(161))).toEqual({ parts: 2, perPart: 153, unicode: false });
    expect(smsParts('a'.repeat(306))).toEqual({ parts: 2, perPart: 153, unicode: false });
    expect(smsParts('a'.repeat(307))).toEqual({ parts: 3, perPart: 153, unicode: false });
  });

  it('counts an extension character as two', () => {
    expect(smsParts('€'.repeat(80)).parts).toBe(1);
    expect(smsParts(`${'€'.repeat(80)}a`).parts).toBe(2);
  });

  it('sends Arabic or an emoji as UCS-2', () => {
    expect(smsParts('مرحبا')).toEqual({ parts: 1, perPart: 70, unicode: true });
    expect(smsParts('a'.repeat(70) + '😀')).toEqual({ parts: 2, perPart: 67, unicode: true });
    expect(smsParts('ب'.repeat(640)).parts).toBe(10);
  });
});
