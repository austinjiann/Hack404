

export interface DangerZoneCircle {
  latitude: number;
  longitude: number;
  radius: number; // meters
}

/**
 * Convert circle danger-zones into GeoJSON polygons (decagons) suitable for
 * OpenRouteService `avoid_polygons`.
 */
type GeoJSONPolygon = { type: 'Polygon'; coordinates: number[][][] };

/**
 * Approximate each circle with an n-sided polygon (default 12).
 * Returns GeoJSON Polygon geometries suitable for ORS `avoid_polygons`.
 */
export function circlesToPolygons(zones: DangerZoneCircle[], steps = 12): GeoJSONPolygon[] {
  const degPerMeter = 1 / 111000; // rough conversion

  return zones.map(z => {
    const coords: number[][] = [];
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      const dx = (z.radius * Math.cos(angle)) * degPerMeter;
      const dy = (z.radius * Math.sin(angle)) * degPerMeter;
      coords.push([z.longitude + dx, z.latitude + dy]);
    }
    // close polygon by repeating first point
    coords.push(coords[0]);
    return { type: 'Polygon', coordinates: [coords] };
  });
}

const ORS_ENDPOINT = 'https://api.openrouteservice.org/v2/directions/foot-walking/geojson';
/**
 * Fetch a walking route from OpenRouteService that completely avoids the given
 * danger-zone circles.  Returns an array of {latitude, longitude} points ready
 * for a MapView <Polyline />.
 *
 * IMPORTANT:  You must set the environment variable `EXPO_PUBLIC_ORS_API_KEY`
 * (or replace the default below) with your free ORS API key.  Sign up at
 * https://openrouteservice.org/sign-up/ – you get 2k requests/day.
 */
export async function getORSRoute(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
  dangerZones: DangerZoneCircle[] = [],
): Promise<{ latitude: number; longitude: number }[] | null> {
  const apiKey = process.env.EXPO_PUBLIC_ORS_API_KEY || 'YOUR_ORS_KEY_HERE';
  if (!apiKey || apiKey === 'YOUR_ORS_KEY_HERE') {
    console.warn('[ORS] Please set EXPO_PUBLIC_ORS_API_KEY with your OpenRouteService key.');
  }

  const polygons = circlesToPolygons(dangerZones);

  const body: any = {
    coordinates: [
      [start.longitude, start.latitude],
      [end.longitude, end.latitude],
    ],
    instructions: false,
    preference: 'shortest',
  };

  if (polygons.length) {
    body.options = {
      avoid_polygons: {
        type: 'FeatureCollection',
        features: polygons.map((geom: any) => ({ type: 'Feature', geometry: geom, properties: {} })),
      },
    };
  }

  try {
    const res = await fetch(ORS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error('[ORS] Bad response', await res.text());
      return null;
    }

    const json = await res.json();
    if (!json.features || !json.features.length) {
      return null;
    }
    return json.features[0].geometry.coordinates.map(([lng, lat]: [number, number]) => ({
      latitude: lat,
      longitude: lng,
    }));
  } catch (e) {
    console.error('[ORS] Network or parsing error', e);
    return null;
  }
}
