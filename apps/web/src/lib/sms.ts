/**
 * How many SMS parts a text takes (M4-29), as the carriers count them: the
 * GSM 03.38 alphabet sends 160 characters in one part and 153 a part once
 * split, its extension characters counting two; any other character (Arabic,
 * an emoji) sends the whole text as UCS-2, 70 in one part and 67 a part split.
 * Shared by the composer's counter and nothing else: the provider splits.
 */
const GSM =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€';

/** The most a text from the lead may hold: four GSM parts, or ten in UCS-2. */
export const SMS_MAX_LENGTH = 640;

export function smsParts(text: string): { parts: number; perPart: number; unicode: boolean } {
  let units = 0;
  for (const ch of text) {
    if (GSM.includes(ch)) units += 1;
    else if (GSM_EXTENDED.includes(ch)) units += 2;
    else {
      // UCS-2 counts UTF-16 code units, which is what `length` is.
      const parts = text.length <= 70 ? 1 : Math.ceil(text.length / 67);
      return { parts, perPart: parts > 1 ? 67 : 70, unicode: true };
    }
  }
  const parts = units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153);
  return { parts, perPart: parts > 1 ? 153 : 160, unicode: false };
}
