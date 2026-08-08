/**
 * What an invitation token resolves to, and what an unauthenticated holder is
 * allowed to see of it.
 *
 * Shared by the public API route and the public page so the two cannot disagree
 * about what is safe to disclose — a page that server-rendered one field more
 * than the API returns would be a leak nobody found by reading the API.
 */
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { verifyRsvpToken } from './rsvpToken';

const ANSWERABLE = ['SCHEDULED', 'LIVE'];

export interface Invitation {
  inviteeId: string;
  tenantId: string;
  name: string | null;
  rsvpStatus: string;
  rsvpAt: Date | null;
  viewedAt: Date | null;
  answerable: boolean;
  event: {
    title: string;
    description: string | null;
    status: string;
    startAt: Date;
    endAt: Date;
    timezone: string;
    location: string | null;
    eventType: string;
    meetingUrl: string | null;
  };
}

/**
 * Throws NotFound for a bad signature, an unknown invitee and a deleted event
 * alike. Distinguishing them would let a holder of one valid token confirm which
 * other invitee ids exist.
 */
export async function loadInvitation(token: string): Promise<Invitation> {
  const claim = verifyRsvpToken(token);
  if (!claim) throw NotFound('Invitation');

  // Fully tenant-scoped, because the token carries the tenant. The public path
  // therefore needs no exception in the tenant guard and none in RLS.
  const invitee = await prisma.eventInvitee.findFirst({
    where: { id: claim.inviteeId, tenantId: claim.tenantId },
    select: {
      id: true,
      tenantId: true,
      name: true,
      rsvpStatus: true,
      rsvpAt: true,
      viewedAt: true,
      event: {
        select: {
          title: true,
          description: true,
          status: true,
          startAt: true,
          endAt: true,
          timezone: true,
          location: true,
          address: true,
          meetingUrl: true,
          eventType: true,
          deletedAt: true,
        },
      },
    },
  });

  if (!invitee || invitee.event.deletedAt) throw NotFound('Invitation');

  return {
    inviteeId: invitee.id,
    tenantId: invitee.tenantId,
    name: invitee.name,
    rsvpStatus: invitee.rsvpStatus,
    rsvpAt: invitee.rsvpAt,
    viewedAt: invitee.viewedAt,
    answerable: ANSWERABLE.includes(invitee.event.status),
    event: {
      title: invitee.event.title,
      description: invitee.event.description,
      status: invitee.event.status,
      startAt: invitee.event.startAt,
      endAt: invitee.event.endAt,
      timezone: invitee.event.timezone,
      location: invitee.event.location ?? invitee.event.address,
      eventType: invitee.event.eventType,
      meetingUrl: invitee.event.meetingUrl,
    },
  };
}

/**
 * The response body, and the one place the disclosure rule lives.
 *
 * The joining link is withheld until the invitee has confirmed, because an
 * invitation that carries the link *is* the link, and invitations get forwarded.
 * Applied here rather than in the loader so that confirming reveals it in the
 * same response — a loader that nulled it early would leave the newly confirmed
 * invitee looking at a blank where their Meet link should be.
 */
export const publicView = (invitation: Invitation) => ({
  // Listed rather than spread-minus-omit, so a field added to Invitation later
  // has to be published deliberately instead of arriving in a public response
  // because nobody updated an exclusion list. `tenantId` and `inviteeId` are the
  // two that must never appear here.
  name: invitation.name,
  rsvpStatus: invitation.rsvpStatus,
  rsvpAt: invitation.rsvpAt,
  answerable: invitation.answerable,
  event: {
    ...invitation.event,
    meetingUrl: invitation.rsvpStatus === 'CONFIRMED' ? invitation.event.meetingUrl : null,
  },
});

export async function recordView(invitation: Invitation): Promise<void> {
  if (invitation.viewedAt) return;
  await prisma.eventInvitee.updateMany({
    where: { id: invitation.inviteeId, tenantId: invitation.tenantId },
    data: { viewedAt: new Date() },
  });
}

export async function recordAnswer(invitation: Invitation, rsvpStatus: string): Promise<Invitation> {
  if (!invitation.answerable) throw NotFound('Invitation');

  const now = new Date();
  await prisma.eventInvitee.updateMany({
    where: { id: invitation.inviteeId, tenantId: invitation.tenantId },
    data: {
      rsvpStatus: rsvpStatus as 'CONFIRMED' | 'DECLINED' | 'TENTATIVE',
      rsvpAt: now,
      rsvpChannel: 'WHATSAPP',
      viewedAt: invitation.viewedAt ?? now,
    },
  });

  return { ...invitation, rsvpStatus, rsvpAt: now, viewedAt: invitation.viewedAt ?? now };
}
