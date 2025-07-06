

// OSRM public endpoint base
const OSRM_BASE = 'https://router.project-osrm.org';

// Fetch JSON with timeout (default 5 s)
async function fetchJson(url: string, timeoutMs = 5000): Promise<any | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

// Snap a point to the nearest road node using OSRM /nearest (fast ~10 ms)
async function snapToRoad(p: { latitude: number; longitude: number }): Promise<{ latitude: number; longitude: number } | null> {
  // 800 ms timeout per nearest query
  const url = `${OSRM_BASE}/nearest/v1/foot/${p.longitude},${p.latitude}?number=1`;
  const json = await fetchJson(url, 800);
  if (!json || !json.waypoints || !json.waypoints.length) return null;
  const [lng, lat] = json.waypoints[0].location;
  return { latitude: lat, longitude: lng };
}

export async function getOSRMRoute(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
  waypoints: { latitude: number; longitude: number }[] = []
): Promise<{ latitude: number; longitude: number }[] | null> {
  const points = [start, ...waypoints, end]
    .map(p => `${p.longitude},${p.latitude}`)
    .join(';');

  const url = `https://router.project-osrm.org/route/v1/foot/${points}?overview=full&geometries=geojson`;

  const json = await fetchJson(url, 6000);
  if (!json || json.code !== 'Ok') return null;
  return json.routes[0].geometry.coordinates.map(([lng, lat]: number[]) => ({
    latitude: lat,
    longitude: lng,
  }));
}

// Helper to find the closest point on a line segment to a point
function closestPointOnLine(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
  point: { latitude: number; longitude: number }
): { latitude: number; longitude: number; t: number } {
  const dx = end.latitude - start.latitude;
  const dy = end.longitude - start.longitude;
  const a = point.latitude - start.latitude;
  const b = point.longitude - start.longitude;
  
  // Calculate projection parameter
  let t = (a * dx + b * dy) / (dx * dx + dy * dy);
  
  // Clamp t to [0,1] to keep point within segment
  t = Math.max(0, Math.min(1, t));
  
  return {
    latitude: start.latitude + dx * t,
    longitude: start.longitude + dy * t,
    t
  };
}

// Helper to calculate distance between points in meters
function distanceInMeters(
  p1: { latitude: number; longitude: number },
  p2: { latitude: number; longitude: number }
): number {
  const dx = (p1.latitude - p2.latitude) * 111000;
  const dy = (p1.longitude - p2.longitude) * 111000;
  return Math.sqrt(dx * dx + dy * dy);
}

// Check if a zone intersects with the direct path
function isZoneInPath(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
  zone: { latitude: number; longitude: number; radius: number }
): boolean {
  // Convert to x,y coordinates for easier math
  const A = { x: start.longitude, y: start.latitude };
  const B = { x: end.longitude, y: end.latitude };
  const P = { x: zone.longitude, y: zone.latitude };

  // Calculate the closest point on the line to the circle center
  const AB = {
    x: B.x - A.x,
    y: B.y - A.y
  };
  const len_sq = AB.x * AB.x + AB.y * AB.y;
  
  if (len_sq === 0) return false;
  
  let t = ((P.x - A.x) * AB.x + (P.y - A.y) * AB.y) / len_sq;
  t = Math.max(0, Math.min(1, t));

  const closest = {
    x: A.x + t * AB.x,
    y: A.y + t * AB.y
  };

  // Calculate distance in meters (rough approximation)
  const dist = Math.sqrt(
    Math.pow(closest.x - P.x, 2) + Math.pow(closest.y - P.y, 2)
  ) * 111000;

  // Add 50m buffer to the zone radius
  return dist < (zone.radius + 50);
}

// Generate waypoints in a square around each danger zone
export function generateDetourPoints(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
  dangerZones: { latitude: number; longitude: number; radius: number }[]
): { latitude: number; longitude: number }[] {
  const detours: { latitude: number; longitude: number }[] = [];

  for (const zone of dangerZones) {
    // Convert radius to degrees (add 50m buffer) - 111000 meters per degree
    const radiusInDegrees = (zone.radius + 50) / 111000;
    
    // Create 8 points around the danger zone in a square pattern
    const points = [
      // Top edge
      { latitude: zone.latitude + radiusInDegrees, longitude: zone.longitude - radiusInDegrees },
      { latitude: zone.latitude + radiusInDegrees, longitude: zone.longitude },
      { latitude: zone.latitude + radiusInDegrees, longitude: zone.longitude + radiusInDegrees },
      
      // Right edge
      { latitude: zone.latitude, longitude: zone.longitude + radiusInDegrees },
      
      // Bottom edge
      { latitude: zone.latitude - radiusInDegrees, longitude: zone.longitude + radiusInDegrees },
      { latitude: zone.latitude - radiusInDegrees, longitude: zone.longitude },
      { latitude: zone.latitude - radiusInDegrees, longitude: zone.longitude - radiusInDegrees },
      
      // Left edge
      { latitude: zone.latitude, longitude: zone.longitude - radiusInDegrees },
    ];

    // Add all points to force a complete detour around the zone
    detours.push(...points);
  }

  return detours;
}

// Main helper to iteratively request OSRM while avoiding danger zones
// Recursively refine legs until each OSRM segment clears all danger zones
async function buildSafeLeg(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
  dangerZones: { latitude: number; longitude: number; radius: number }[],
  depth = 0,
): Promise<{ latitude: number; longitude: number }[] | null> {
  if (depth > 6) return null; // prevent infinite recursion
  const route = await getOSRMRoute(start, end);
  if (!route) return null;
  if (isPathSafe(route, dangerZones)) return route;
  // Identify the first zone intersected by this OSRM geometry
  let offending: (typeof dangerZones)[number] | undefined;
  for (const pt of route) {
    offending = dangerZones.find(z => isPointInDangerZone(pt, z));
    if (offending) break;
  }
  if (!offending) return null;
  // Generate two tangential pivots relative to offending zone
  // Try increasing buffer distances until a safe pivot produces a safe route
  for (const extra of [30, 60, 90, 120]) {
    const pivots = tangentialPivots(offending, start, end, extra);
    for (const pivot of pivots) {
      // Ensure pivot itself is outside all zones
      if (dangerZones.some(z => isPointInDangerZone(pivot, z))) continue;
      const firstHalf = await buildSafeLeg(start, pivot, dangerZones, depth + 1);
      if (!firstHalf) continue;
      const secondHalf = await buildSafeLeg(pivot, end, dangerZones, depth + 1);
      if (!secondHalf) continue;
      return firstHalf.concat(secondHalf.slice(1));
    }
  }
  return null;
}

// Generate an arc of waypoints around a circle on the chosen side
function generateArcDetour(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
  zone: { latitude: number; longitude: number; radius: number },
  steps = 5,
  buffer = 40,
): { latitude: number; longitude: number }[] {
  // Determine which side of the circle (left/right of the line) we should detour on
  const cross =
    (end.longitude - start.longitude) * (zone.latitude - start.latitude) -
    (end.latitude - start.latitude) * (zone.longitude - start.longitude);
  const side = cross > 0 ? 1 : -1; // +1 = left, -1 = right

  // Base angle from circle to line midpoint
  const midLat = (start.latitude + end.latitude) / 2;
  const midLng = (start.longitude + end.longitude) / 2;
  const baseAngle = Math.atan2(midLat - zone.latitude, midLng - zone.longitude);

  const radiusDeg = (zone.radius + buffer) / 111000;
  const delta = (Math.PI / 3) / steps; // sweep ~60°

  const points: { latitude: number; longitude: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const ang = baseAngle + side * (delta * i);
    points.push({
      latitude: zone.latitude + radiusDeg * Math.sin(ang),
      longitude: zone.longitude + radiusDeg * Math.cos(ang),
    });
  }
  return points;
}

// Create two points just outside the danger zone tangent to the line start→end
function tangentialPivots(
  zone: { latitude: number; longitude: number; radius: number },
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
  buffer = 30,
): { latitude: number; longitude: number }[] {
  // Angle of the line from zone to start and end midpoint
  const midLat = (start.latitude + end.latitude) / 2;
  const midLng = (start.longitude + end.longitude) / 2;
  const baseAngle = Math.atan2(midLat - zone.latitude, midLng - zone.longitude);
  const offsetDist = (zone.radius + buffer) / 111000; // degrees
  // Tangential angles ±90° from base direction
  const p1Angle = baseAngle + Math.PI / 2;
  const p2Angle = baseAngle - Math.PI / 2;
  return [p1Angle, p2Angle].map(a => ({
    latitude: zone.latitude + offsetDist * Math.sin(a),
    longitude: zone.longitude + offsetDist * Math.cos(a),
  }));
}

export async function getSafeWalkingRoute(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
  dangerZones: { latitude: number; longitude: number; radius: number }[],
  maxTries = 5,
): Promise<{ latitude: number; longitude: number }[] | null> {
  if (!dangerZones.length) return getOSRMRoute(start, end);

    // Fast path: build snapped anchor points around each blocking circle
  const tangentCandidates: { latitude: number; longitude: number }[] = [];
  for (const z of dangerZones) {
    if (!isZoneOnPath(start, end, z)) continue;
    // entry + exit tangential points (buffer 40m)
    tangentCandidates.push(...tangentialPivots(z, start, end, 40));
  }
  // snap all candidates in parallel (fast)
  const snapResults = await Promise.allSettled(tangentCandidates.map(snapToRoad));
  const anchors: { latitude: number; longitude: number }[] = snapResults
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => (r as PromiseFulfilledResult<{ latitude: number; longitude: number }>).value!)
    .filter(pt => isPathSafe([pt], dangerZones));

  if (anchors.length) {
    anchors.sort((a, b) => distanceInMeters(start, a) - distanceInMeters(start, b));
    // Abort quick route if it exceeds 1.2 s
    const quickRoute = await Promise.race([
      getOSRMRoute(start, end, anchors),
      new Promise<null>(res => setTimeout(() => res(null), 1200)),
    ]);
    if (quickRoute && isPathSafe(quickRoute as any, dangerZones)) {
      return quickRoute as any;
    }
  }

  // Fallback to recursive refinement
  return buildSafeLeg(start, end, dangerZones);

}

// Helper to check if a point is inside a danger zone
function isPointInDangerZone(
  point: { latitude: number; longitude: number },
  zone: { latitude: number; longitude: number; radius: number }
): boolean {
  return distanceInMeters(point, zone) <= zone.radius;
}

// Check if a path is safe (not intersecting any danger zones)
export function isPathSafe(
  path: { latitude: number; longitude: number }[],
  dangerZones: { latitude: number; longitude: number; radius: number }[]
): boolean {
  // Check each point and interpolated points between segments
  for (let i = 0; i < path.length; i++) {
    const point = path[i];
    
    // Check the point itself
    for (const zone of dangerZones) {
      if (isPointInDangerZone(point, zone)) {
        return false;
      }
    }
    
    // Check points between segments
    if (i < path.length - 1) {
      const next = path[i + 1];
      const steps = 5; // Check 5 points along each segment
      
      for (let j = 1; j < steps; j++) {
        const t = j / steps;
        const interpolated = {
          latitude: point.latitude + (next.latitude - point.latitude) * t,
          longitude: point.longitude + (next.longitude - point.longitude) * t
        };
        
        for (const zone of dangerZones) {
          if (isPointInDangerZone(interpolated, zone)) {
            return false;
          }
        }
      }
    }
  }
  
  return true;
}

// Distance from point to line segment (in meters)
function isZoneOnPath(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
  zone: { latitude: number; longitude: number; radius: number },
  buffer: number = 40
): boolean {
  const A = { x: start.longitude, y: start.latitude };
  const B = { x: end.longitude, y: end.latitude };
  const C = { x: zone.longitude, y: zone.latitude };

  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const lengthSq = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((C.x - A.x) * dx + (C.y - A.y) * dy) / lengthSq));

  const closestX = A.x + t * dx;
  const closestY = A.y + t * dy;

  const dist = Math.sqrt((C.x - closestX) ** 2 + (C.y - closestY) ** 2) * 111000;

  return dist < (zone.radius + buffer);
}

// Generate smart detour points around zones intersecting the direct path
export function generateSmartDetours(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
  dangerZones: { latitude: number; longitude: number; radius: number }[]
): { latitude: number; longitude: number }[] {
  const detours = [];

  for (const zone of dangerZones) {
    if (!isZoneOnPath(start, end, zone)) continue;

    const angle = Math.atan2(
      end.latitude - start.latitude,
      end.longitude - start.longitude
    );

    const offset = (zone.radius + 60) / 111000;
    const detourAngle1 = angle + Math.PI / 2;
    const detourAngle2 = angle - Math.PI / 2;

    const detour1 = {
      latitude: zone.latitude + offset * Math.sin(detourAngle1),
      longitude: zone.longitude + offset * Math.cos(detourAngle1),
    };

    const detour2 = {
      latitude: zone.latitude + offset * Math.sin(detourAngle2),
      longitude: zone.longitude + offset * Math.cos(detourAngle2),
    };

    const d1 = Math.hypot(detour1.latitude - start.latitude, detour1.longitude - start.longitude);
    const d2 = Math.hypot(detour2.latitude - start.latitude, detour2.longitude - start.longitude);
    detours.push(d1 < d2 ? detour1 : detour2);
  }

  return detours;
} 