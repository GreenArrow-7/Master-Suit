/**
 * Arriving at, and leaving, a site visit.
 *
 * The browser cannot tell a real GPS fix from a mocked one — there is no
 * equivalent of Android's `isFromMockProvider`, and any flag the page could send
 * is a boolean the page could also lie about. So nothing here trusts the client
 * beyond the raw coordinates, and the checks are all server-side and
 * after-the-fact:
 *
 *   - **distance** from the destination, against a workspace radius;
 *   - **travel speed** implied by the gap to this agent's previous punch;
 *   - **coordinates repeated to seven decimal places**, which a moving human
 *     does not produce twice.
 *
 * Every one of them *flags*. None of them blocks. A genuine viewing reached
 * from a passenger seat on a motorway looks exactly like a fast one, and a
 * salesperson locked out of their own check-in at a client's door will simply
 * stop using the register — which costs more than the fraud it would prevent.
 */
import { Conflict, Invalid, NotFound } from '@/lib/errors';
import { prisma, withTx, type TxClient } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { haversineM, insideGeofence } from '@/lib/geo';
import type { Ctx } from '@/lib/security/rbac';

export interface VisitPolicy {
  radiusM: number;
  maxTravelKph: number;
}

export async function visitPolicy(tenantId: string): Promise<VisitPolicy> {
  const setting = await prisma.organizationSetting.findUnique({
    where: { tenantId },
    select: { visitGeofenceRadiusM: true, visitMaxTravelKph: true },
  });
  return {
    radiusM: setting?.visitGeofenceRadiusM ?? 250,
    maxTravelKph: setting?.visitMaxTravelKph ?? 160,
  };
}

/** GPS noise beyond this makes a fix worthless for a geofence decision. */
const MAX_USEFUL_ACCURACY_M = 500;

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracyM?: number;
}

export interface Suspicion {
  suspect: boolean;
  reason: string | null;
}

/**
 * The plausibility checks, as a pure function so they can be tested without a
 * database and read without following a query.
 */
export function assessPlausibility(
  now: Coordinates,
  at: Date,
  previous: { latitude: number; longitude: number; at: Date } | null,
  policy: VisitPolicy,
): Suspicion {
  const reasons: string[] = [];

  if ((now.accuracyM ?? 0) > MAX_USEFUL_ACCURACY_M) {
    reasons.push(`GPS accuracy was ${Math.round(now.accuracyM!)}m, too coarse to place`);
  }

  if (previous) {
    const metres = haversineM(previous.latitude, previous.longitude, now.latitude, now.longitude);
    const seconds = (at.getTime() - previous.at.getTime()) / 1000;

    // Two punches at the same instant cannot be checked for speed; they are
    // suspicious for a different reason.
    if (seconds <= 0) {
      if (metres > 0) reasons.push('punched from two places at the same moment');
    } else {
      const kph = (metres / seconds) * 3.6;
      if (kph > policy.maxTravelKph) {
        reasons.push(`implied travel of ${Math.round(kph)} km/h from the previous punch`);
      }
    }

    // Identical to seven decimal places is roughly a centimetre. A phone
    // reporting that twice from a moving person is reporting a stored value.
    if (metres === 0 && seconds > 60) {
      reasons.push('coordinates identical to the previous punch');
    }
  }

  return { suspect: reasons.length > 0, reason: reasons.length ? reasons.join('; ') : null };
}

/**
 * Where the visit is supposed to be. Falls back through the destination chain.
 *
 * `tx` is required, not defaulted. These lookups run inside `withTx`, which sets
 * `app.tenant_id` on its own connection — a query issued through the global
 * client from in here lands on a different pooled connection with no tenant
 * context, and row-level security returns nothing. The symptom is not an error:
 * it is a geofence that silently has nothing to measure against, so every punch
 * comes back `geofenceOk: null` and every visit looks unverifiable.
 */
async function destinationOf(
  tx: TxClient,
  tenantId: string,
  visit: {
    latitude: number | null;
    longitude: number | null;
    projectId: string | null;
    listingId: string | null;
  },
): Promise<{ latitude: number; longitude: number } | null> {
  if (visit.latitude != null && visit.longitude != null) {
    return { latitude: visit.latitude, longitude: visit.longitude };
  }
  if (visit.projectId) {
    const project = await tx.project.findFirst({
      where: { id: visit.projectId, tenantId },
      select: { latitude: true, longitude: true },
    });
    if (project?.latitude != null && project.longitude != null) {
      return { latitude: project.latitude, longitude: project.longitude };
    }
  }
  if (visit.listingId) {
    const listing = await tx.listing.findFirst({
      where: { id: visit.listingId, tenantId },
      select: { latitude: true, longitude: true },
    });
    if (listing?.latitude != null && listing.longitude != null) {
      return { latitude: listing.latitude, longitude: listing.longitude };
    }
  }
  return null;
}

export interface PunchInput {
  ctx: Ctx;
  visitId: string;
  direction: 'in' | 'out';
  coordinates: Coordinates;
}

export async function punch(input: PunchInput) {
  const { ctx, coordinates } = input;
  const policy = await visitPolicy(ctx.tenantId);
  const now = new Date();

  return withTx(ctx.tenantId, async (tx) => {
    const visit = await tx.siteVisit.findFirst({
      where: { id: input.visitId, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!visit) throw NotFound('Site visit');

    // Only the agent on the visit punches for it. A colleague checking somebody
    // in from the office is the exact thing a register is meant to catch.
    if (visit.ownerId !== ctx.actor.id) {
      throw Conflict('Only the agent on this visit can check in or out of it.');
    }

    if (input.direction === 'in') {
      if (visit.status !== 'APPROVED') {
        throw Invalid([
          {
            field: 'status',
            code: 'not_approved',
            message:
              visit.status === 'REQUESTED'
                ? 'This visit has not been approved yet.'
                : `A ${visit.status.toLowerCase().replace('_', ' ')} visit cannot be checked into.`,
          },
        ]);
      }
    } else if (visit.status !== 'CHECKED_IN') {
      throw Invalid([{ field: 'status', code: 'not_checked_in', message: 'Check in before checking out.' }]);
    }

    // The previous punch by this agent, whichever visit it belonged to. Speed is
    // a property of the person's day, not of one record.
    const previous = await tx.siteVisit.findFirst({
      where: {
        tenantId: ctx.tenantId,
        ownerId: ctx.actor.id,
        id: { not: visit.id },
        checkInAt: { not: null },
        checkInLat: { not: null },
      },
      orderBy: { checkInAt: 'desc' },
      select: { checkInAt: true, checkInLat: true, checkInLng: true },
    });

    const suspicion = assessPlausibility(
      coordinates,
      now,
      previous?.checkInAt && previous.checkInLat != null && previous.checkInLng != null
        ? { latitude: previous.checkInLat, longitude: previous.checkInLng, at: previous.checkInAt }
        : null,
      policy,
    );

    const destination = await destinationOf(tx, ctx.tenantId, visit);
    const distanceM = destination
      ? Math.round(haversineM(destination.latitude, destination.longitude, coordinates.latitude, coordinates.longitude))
      : null;
    const geofenceOk = distanceM == null ? null : insideGeofence(distanceM, policy.radiusM);

    const updated = await tx.siteVisit.update({
      where: { id: visit.id, tenantId: ctx.tenantId },
      data:
        input.direction === 'in'
          ? {
              status: 'CHECKED_IN',
              checkInAt: now,
              checkInLat: coordinates.latitude,
              checkInLng: coordinates.longitude,
              checkInAccuracy: coordinates.accuracyM,
              distanceMeters: distanceM,
              geofenceOk,
              // Never cleared by a later punch: once a day looked wrong, it did.
              locationSuspect: visit.locationSuspect || suspicion.suspect,
              suspectReason: suspicion.reason ?? visit.suspectReason,
              updatedById: ctx.actor.id,
            }
          : {
              checkOutAt: now,
              checkOutLat: coordinates.latitude,
              checkOutLng: coordinates.longitude,
              locationSuspect: visit.locationSuspect || suspicion.suspect,
              suspectReason: suspicion.reason ?? visit.suspectReason,
              updatedById: ctx.actor.id,
            },
    });

    await audit(
      ctx,
      {
        event: input.direction === 'in' ? 'STAGE_CHANGED' : 'RECORD_UPDATED',
        objectType: 'visits',
        recordId: visit.id,
        previousValue: { status: visit.status },
        newValue: {
          punch: input.direction,
          distanceMeters: distanceM,
          geofenceOk,
          suspect: suspicion.suspect,
          reason: suspicion.reason,
        },
      },
      tx,
    );

    return {
      visit: updated,
      distanceMeters: distanceM,
      geofenceOk,
      /** Recorded and flagged, never refused — see the note at the top. */
      suspect: suspicion.suspect,
      suspectReason: suspicion.reason,
    };
  });
}
