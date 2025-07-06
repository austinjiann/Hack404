export interface Point { latitude: number; longitude: number }
export interface DangerZone { latitude: number; longitude: number; radius: number }

const EARTH_RADIUS = 6371000; // meters

function toRad(deg: number) { return (deg * Math.PI) / 180; }

function distanceMeters(p1: Point, p2: Point) {
  const dLat = toRad(p2.latitude - p1.latitude);
  const dLon = toRad(p2.longitude - p1.longitude);
  const lat1 = toRad(p1.latitude);
  const lat2 = toRad(p2.latitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Distance from point C to line AB (in meters)
function distancePointToSegment(A: Point, B: Point, C: Point) {
  const Axyz = { x: A.longitude, y: A.latitude };
  const Bxyz = { x: B.longitude, y: B.latitude };
  const Cxyz = { x: C.longitude, y: C.latitude };
  const dx = Bxyz.x - Axyz.x;
  const dy = Bxyz.y - Axyz.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distanceMeters(A, C);
  let t = ((Cxyz.x - Axyz.x) * dx + (Cxyz.y - Axyz.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: Axyz.x + t * dx, y: Axyz.y + t * dy };
  return distanceMeters({ latitude: proj.y, longitude: proj.x }, C);
}

function segmentIntersectsZone(A: Point, B: Point, zone: DangerZone, buffer = 0) {
  return distancePointToSegment(A, B, zone) < zone.radius + buffer;
}

function anyIntersection(A: Point, B: Point, zones: DangerZone[]) {
  return zones.some(z => segmentIntersectsZone(A, B, z, 5));
}

function detourAround(A: Point, B: Point, zone: DangerZone): Point {
  // Perpendicular offset from the line AB at the closest point to zone center
  const dx = B.longitude - A.longitude;
  const dy = B.latitude - A.latitude;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  // perpendicular unit vectors
  const px = -uy;
  const py = ux;
  // choose side that places point farther from zone center
  const offsetDeg = (zone.radius + 30) / 111000; // add 30 m buffer, convert to degrees
  const cand1: Point = {
    latitude: zone.latitude + py * offsetDeg,
    longitude: zone.longitude + px * offsetDeg,
  };
  const cand2: Point = {
    latitude: zone.latitude - py * offsetDeg,
    longitude: zone.longitude - px * offsetDeg,
  };
  const d1 = distanceMeters(cand1, zone);
  const d2 = distanceMeters(cand2, zone);
  return d1 > d2 ? cand1 : cand2;
}

export function getLocalSafePath(start: Point, end: Point, zones: DangerZone[]): Point[] {
  const path: Point[] = [start, end];
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 20) {
    iterations++;
    changed = false;
    for (let i = 0; i < path.length - 1; i++) {
      const A = path[i];
      const B = path[i + 1];
      const intersecting = zones.find(z => segmentIntersectsZone(A, B, z, 5));
      if (intersecting) {
        const detour = detourAround(A, B, intersecting);
        path.splice(i + 1, 0, detour);
        changed = true;
        break; // restart loop after mutation
      }
    }
  }
  return path;
}
