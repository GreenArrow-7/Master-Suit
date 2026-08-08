/**
 * Geometry, shared by HR attendance and by sales site visits.
 *
 * Lifted out of `services/hr/rules.ts` when the second caller arrived. It is
 * pure arithmetic with no policy in it — where the radius comes from, and what
 * happens when somebody is outside it, differ completely between an office
 * punch and a property viewing, and both of those stay with their own module.
 */

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * GPS accuracy is subtracted so someone genuinely standing at the edge of the
 * fence is not rejected by sensor noise. A client-reported "I am inside" flag is
 * never trusted — only the coordinates, measured here.
 */
export function insideGeofence(distanceM: number, radiusM: number, gpsAccuracyM = 0): boolean {
  return distanceM - Math.max(gpsAccuracyM, 0) <= radiusM;
}
