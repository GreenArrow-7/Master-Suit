/**
 * The target metrics and their human labels. A plain module on purpose: the
 * server page and the client composer both need it, and importing a value
 * through a 'use client' boundary hands the server a client-reference proxy
 * rather than the array.
 */
export const METRICS = [
  ['CALLS_ATTEMPTED', 'Client calls to attempt'],
  ['CALLS_CONNECTED', 'Calls to connect'],
  ['LEADS_ASSIGNED', 'Leads to contact'],
  ['FOLLOWUPS_COMPLETED', 'Follow-ups to complete'],
  ['INVITATIONS_SENT', 'Meeting invitations to send'],
  ['RSVPS_CONFIRMED', 'Meetings to confirm'],
  ['LEADS_QUALIFIED', 'Leads to qualify'],
  ['LEADS_CONVERTED', 'Conversions to close'],
] as const;
