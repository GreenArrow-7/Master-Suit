/**
 * What a lead stage books as a lead enters it (M4-18), named in
 * `LeadStage.requiredFields` beside the lead's own fields. The move carries the
 * time (a visit also its project), and updateLead writes the site visit or the
 * meeting task in the transaction that moves the stage; without them it refuses.
 */
export const BOOKING_FIELDS = ['visitAt', 'meetingAt'] as const;

export const BOOKING_LABELS: Record<(typeof BOOKING_FIELDS)[number], string> = {
  visitAt: 'Site visit: date, time and project',
  meetingAt: 'Meeting: date and time',
};
