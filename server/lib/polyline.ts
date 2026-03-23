import polyline from '@mapbox/polyline';

/**
 * Decode a Google encoded polyline to [lng, lat][] (GeoJSON order).
 * @mapbox/polyline.decode() returns [lat, lng][] so we swap.
 */
export function decodePolyline(encoded: string): [number, number][] {
  const decoded = polyline.decode(encoded); // [lat, lng][]
  return decoded.map(([lat, lng]) => [lng, lat] as [number, number]);
}
