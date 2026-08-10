'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * HRMS-v21's location picker: a Leaflet map to place the geofence by clicking or
 * dragging the marker, a live circle previewing the radius, and address search.
 *
 * Leaflet is bundled (not a CDN) so it satisfies script-src 'self'; OSM tiles
 * load as https images, which img-src allows; address search goes through our
 * own /api/v1/geocode because connect-src is 'self'. The manual latitude,
 * longitude and radius inputs stay — coordinates pasted from Google Maps are
 * often the fastest path — and the map and the inputs are two views of the same
 * numbers, kept in sync both ways.
 */
const DEFAULT_CENTER: [number, number] = [25.2048, 55.2708]; // Dubai

export default function LocationMapForm({ endpoint }: { endpoint: string }) {
  const router = useRouter();
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markerRef = useRef<Leaflet.Marker | null>(null);
  const circleRef = useRef<Leaflet.Circle | null>(null);

  const [form, setForm] = useState({
    name: '',
    code: '',
    latitude: '',
    longitude: '',
    radiusMeters: '150',
    maxAccuracyMeters: '',
    openingTime: '',
    closingTime: '',
    emirate: '',
    status: 'ACTIVE',
  });
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ label: string; latitude: number; longitude: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  // Place / move the marker and radius circle, and reflect the point into the
  // latitude/longitude fields. One function so a map click, a marker drag and a
  // search result all converge here.
  function place(lat: number, lng: number, recenter = false) {
    setForm((f) => ({ ...f, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }));
    const map = mapRef.current;
    if (!map) return;
    if (recenter) map.setView([lat, lng], Math.max(map.getZoom(), 16));
    markerRef.current?.setLatLng([lat, lng]);
    circleRef.current?.setLatLng([lat, lng]);
  }

  useEffect(() => {
    // Leaflet touches `window` at import time, so it is loaded in the browser
    // only — a static top-level import crashes server rendering.
    let disposed = false;
    let cleanup = () => {};
    void (async () => {
      const L = (await import('leaflet')).default;
      if (disposed || !mapEl.current || mapRef.current) return;
      const map = L.map(mapEl.current).setView(DEFAULT_CENTER, 12);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      // An inline SVG pin: Leaflet's default PNG marker resolves to bundler
      // paths that 404, and a divIcon needs no image asset at all.
      const pin = L.divIcon({
        className: 'lf-map-pin',
        html: '<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><path d="M13 0C5.8 0 0 5.8 0 13c0 9 13 21 13 21s13-12 13-21C26 5.8 20.2 0 13 0z" fill="#0e3b2e"/><circle cx="13" cy="13" r="5" fill="#f2f7f4"/></svg>',
        iconSize: [26, 34],
        iconAnchor: [13, 34],
      });
      const marker = L.marker(DEFAULT_CENTER, { draggable: true, icon: pin }).addTo(map);
      const circle = L.circle(DEFAULT_CENTER, {
        radius: 150,
        color: '#0e3b2e',
        fillColor: '#1c6b52',
        fillOpacity: 0.15,
      }).addTo(map);
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLatLng();
        place(lat, lng);
      });
      map.on('click', (e: Leaflet.LeafletMouseEvent) => place(e.latlng.lat, e.latlng.lng));

      mapRef.current = map;
      markerRef.current = marker;
      circleRef.current = circle;
      // Leaflet miscalculates tile size when its container was laid out after
      // the map was created; a nudge on the next frame fixes the grey tiles.
      setTimeout(() => map.invalidateSize(), 0);
      cleanup = () => {
        map.remove();
        mapRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  // Keep the circle honest as the radius input changes.
  useEffect(() => {
    const r = Number(form.radiusMeters);
    if (circleRef.current && r > 0) circleRef.current.setRadius(r);
  }, [form.radiusMeters]);

  // Typed coordinates drive the map too — someone pasting from Google Maps.
  useEffect(() => {
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && form.latitude !== '' && form.longitude !== '') {
      markerRef.current?.setLatLng([lat, lng]);
      circleRef.current?.setLatLng([lat, lng]);
    }
  }, [form.latitude, form.longitude]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/geocode?q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({ results: [] }));
      setResults(data.results ?? []);
      if ((data.results ?? []).length === 0) setError('No match for that address.');
    } catch {
      setError('Address search is unavailable right now.');
    } finally {
      setSearching(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.latitude || !form.longitude) {
      setError('Name and a point on the map are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          ...(form.code ? { code: form.code } : {}),
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
          radiusMeters: Number(form.radiusMeters),
          ...(form.maxAccuracyMeters ? { maxAccuracyMeters: Number(form.maxAccuracyMeters) } : {}),
          ...(form.openingTime ? { openingTime: form.openingTime } : {}),
          ...(form.closingTime ? { closingTime: form.closingTime } : {}),
          ...(form.emirate ? { emirate: form.emirate } : {}),
          status: form.status,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? data.detail : 'Could not create this location.');
        return;
      }
      router.refresh();
      setForm((f) => ({ ...f, name: '', code: '', latitude: '', longitude: '' }));
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="lf-card" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 'var(--lf-space-4)' }} noValidate>
      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gap: 'var(--lf-space-2)' }}>
        <div style={{ display: 'flex', gap: 'var(--lf-space-2)' }}>
          <input
            className="lf-input"
            placeholder="Search an address, or click the map to drop the pin"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search address"
            onKeyDown={(e) => {
              if (e.key === 'Enter') search(e);
            }}
          />
          <button type="button" className="lf-btn lf-btn--sm" onClick={search} disabled={searching}>
            {searching ? 'Searching…' : 'Find'}
          </button>
        </div>
        {results.length > 0 && (
          <div style={{ display: 'grid', gap: 2, maxHeight: 140, overflowY: 'auto' }}>
            {results.map((row, i) => (
              <button
                type="button"
                key={i}
                className="lf-btn lf-btn--ghost"
                style={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 'var(--lf-text-sm)' }}
                onClick={() => {
                  place(row.latitude, row.longitude, true);
                  setResults([]);
                  setQ(row.label);
                }}
              >
                {row.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={mapEl} style={{ height: 320, borderRadius: 'var(--lf-radius-sm)', overflow: 'hidden', border: '1px solid var(--lf-line)' }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--lf-space-3)' }}>
        <div className="lf-field">
          <label className="lf-label" htmlFor="wl-name">Location name</label>
          <input id="wl-name" className="lf-input" value={form.name} onChange={set('name')} required />
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="wl-code">Code</label>
          <input id="wl-code" className="lf-input" value={form.code} onChange={set('code')} />
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="wl-lat">Latitude</label>
          <input id="wl-lat" className="lf-input" value={form.latitude} onChange={set('latitude')} inputMode="decimal" required />
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="wl-lng">Longitude</label>
          <input id="wl-lng" className="lf-input" value={form.longitude} onChange={set('longitude')} inputMode="decimal" required />
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="wl-radius">Radius (metres)</label>
          <input id="wl-radius" className="lf-input" type="number" min={10} max={10000} value={form.radiusMeters} onChange={set('radiusMeters')} required />
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="wl-acc">Worst acceptable GPS accuracy (m)</label>
          <input id="wl-acc" className="lf-input" type="number" min={5} max={1000} value={form.maxAccuracyMeters} onChange={set('maxAccuracyMeters')} placeholder="100" />
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="wl-open">Opening time</label>
          <input id="wl-open" className="lf-input" type="time" value={form.openingTime} onChange={set('openingTime')} />
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="wl-close">Closing time</label>
          <input id="wl-close" className="lf-input" type="time" value={form.closingTime} onChange={set('closingTime')} />
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="wl-emirate">Emirate</label>
          <input id="wl-emirate" className="lf-input" value={form.emirate} onChange={set('emirate')} />
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="wl-status">Status</label>
          <select id="wl-status" className="lf-input" value={form.status} onChange={set('status')}>
            <option value="ACTIVE">Active</option>
            <option value="DRAFT">Draft</option>
            <option value="RETIRED">Retired</option>
          </select>
        </div>
      </div>

      <div>
        <button className="lf-btn" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create location'}
        </button>
      </div>
    </form>
  );
}
