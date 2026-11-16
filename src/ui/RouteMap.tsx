import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { Route } from '../core/types';

/** Karte mit Strecke und optionaler aktueller Position. */
export function RouteMap({ route, lat, lon, follow, height = 260 }: { route: Route; lat?: number; lon?: number; follow?: boolean; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© OpenStreetMap-Mitwirkende',
    }).addTo(m);
    const stride = Math.max(1, Math.floor(route.points.length / 2000));
    const line = L.polyline(
      route.points.filter((_, i) => i % stride === 0).map((p) => [p.lat, p.lon] as [number, number]),
      { color: '#f5a524', weight: 4 },
    ).addTo(m);
    m.fitBounds(line.getBounds(), { padding: [20, 20] });
    map.current = m;
    marker.current = null;
    return () => {
      m.remove();
      map.current = null;
    };
  }, [route]);

  useEffect(() => {
    const m = map.current;
    if (!m || lat === undefined || lon === undefined) return;
    if (!marker.current) {
      marker.current = L.circleMarker([lat, lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#e5484d', fillOpacity: 1 }).addTo(m);
      if (follow) m.setView([lat, lon], 15);
    } else marker.current.setLatLng([lat, lon]);
    if (follow && !m.getBounds().pad(-0.25).contains([lat, lon])) m.panTo([lat, lon]);
  }, [lat, lon, follow]);

  return <div ref={el} className="map" style={{ height }} />;
}
