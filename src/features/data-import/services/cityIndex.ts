import { distanceKm } from '@/shared/geo/bounds';

/**
 * Offline city index (BOA-118). Resolves a coordinate to a nearest city name
 * from a bundled GeoNames dataset — no external geocoding API, since Nominatim
 * forbids grid reverse-geocoding and offers no SLA. See scripts/build-cities.ts.
 */

/** [name, lat, lng, population, countryCode] — compact rows from /data/cities.json. */
export type CityRow = [string, number, number, number, string];

export interface City {
  name: string;
  country: string;
  lat: number;
  lng: number;
}

/** Within this radius, prefer the most populous city so suburbs merge into the
 *  metro (matches the 25km clustering threshold used elsewhere in the app). */
const METRO_RADIUS_KM = 25;
/** Beyond this, we have no confident city — caller uses an "Area N" fallback. */
const MAX_MATCH_KM = 150;

let citiesPromise: Promise<CityRow[]> | null = null;

/** Lazy-load the bundled city dataset once; cached for the session. */
export function loadCities(signal?: AbortSignal): Promise<CityRow[]> {
  if (!citiesPromise) {
    citiesPromise = fetch('/geo/cities.json', { signal })
      .then((res) => {
        if (!res.ok) throw new Error(`cities.json ${res.status}`);
        return res.json() as Promise<CityRow[]>;
      })
      .catch((err) => {
        citiesPromise = null; // allow a retry on the next clustering pass
        throw err;
      });
  }
  return citiesPromise;
}

/**
 * Nearest city to a coordinate. Within {@link METRO_RADIUS_KM} returns the most
 * populous candidate (suburbs → metro); otherwise the closest city within
 * {@link MAX_MATCH_KM}. Returns null when nothing is close enough.
 */
export function nearestCity(lat: number, lng: number, cities: CityRow[]): City | null {
  let nearest: CityRow | null = null;
  let nearestKm = Infinity;
  let metro: CityRow | null = null;
  let metroPop = -1;

  for (const c of cities) {
    const km = distanceKm(lat, lng, c[1], c[2]);
    if (km < nearestKm) { nearestKm = km; nearest = c; }
    if (km <= METRO_RADIUS_KM && c[3] > metroPop) { metroPop = c[3]; metro = c; }
  }

  const pick = metro ?? (nearestKm <= MAX_MATCH_KM ? nearest : null);
  if (!pick) return null;
  return { name: pick[0], country: pick[4], lat: pick[1], lng: pick[2] };
}
