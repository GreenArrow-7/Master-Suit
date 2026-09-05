import { z } from 'zod';
import { route } from '@/lib/api/handler';

/**
 * Server-side address search for the work-location map picker.
 *
 * The browser's CSP is `connect-src 'self'`, so the page cannot call an
 * external geocoder directly — and shouldn't: routing it through the server
 * keeps the third party from seeing the workspace's session, lets us set a
 * proper User-Agent (Nominatim requires one), and gives one place to swap the
 * provider. Gated on `locations.manage` (employee:EDIT), the same permission
 * that may place a fence in the first place.
 */
const query = z.object({ q: z.string().min(2).max(200) });

export const GET = route(
  {
    module: 'employee',
    productModule: 'HRMS',
    action: 'EDIT',
    query,
    rateLimit: { max: 30, windowSeconds: 60 },
  },
  async ({ query: q }) => {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', q.q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '5');
    url.searchParams.set('addressdetails', '0');

    const res = await fetch(url, {
      headers: { 'User-Agent': 'YouhanOne/1.0 (work-location geocoding)' },
      // A slow geocoder must not hang the request thread indefinitely.
      signal: AbortSignal.timeout(6_000),
    }).catch(() => null);

    if (!res || !res.ok) return { results: [] };
    const raw = (await res.json().catch(() => [])) as { lat: string; lon: string; display_name: string }[];
    return {
      results: raw.map((row) => ({
        label: row.display_name,
        latitude: Number(row.lat),
        longitude: Number(row.lon),
      })),
    };
  },
);
