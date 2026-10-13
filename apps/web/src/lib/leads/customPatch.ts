/**
 * What the lead Overview's Edit details sends as `custom` (M4-13): each field
 * whose value changed, and each required one left empty, even when only
 * another detail changed, so the server refuses the save naming that field
 * (services/leads/customFields fieldValue). null clears a value; undefined
 * means nothing to send. A field defined after the page loaded reads as empty.
 */
export function customPatch(
  fields: { key: string; isRequired: boolean }[],
  values: Record<string, string>,
  start: Record<string, string>,
) {
  const sent = fields.flatMap((field) => {
    const value = (values[field.key] ?? '').trim();
    const changed = value !== (start[field.key] ?? '');
    return changed || (field.isRequired && !value) ? [[field.key, value || null] as const] : [];
  });
  return sent.length ? Object.fromEntries(sent) : undefined;
}
