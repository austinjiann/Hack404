// Offline A* pathfinder that routes on the pre-built road graph while avoiding danger circles
import { getRoadGraph, NodeId, Graph } from './graphBuilder';

export interface LatLng { latitude: number; longitude: number }
export interface DangerCircle { latitude: number; longitude: number; radius: number }

function distanceMeters(a: LatLng, b: LatLng) {
  const dx = (a.latitude - b.latitude) * 111_000;
  const dy = (a.longitude - b.longitude) * 111_000 * Math.cos(((a.latitude + b.latitude) / 2) * (Math.PI / 180));
  return Math.hypot(dx, dy);
}

function nodeDistance(a: NodeId, b: NodeId, graph: Graph) {
  const na = graph.nodes[a];
  const nb = graph.nodes[b];
  return distanceMeters({ latitude: na.lat, longitude: na.lng }, { latitude: nb.lat, longitude: nb.lng });
}

function inDanger(node: NodeId, zones: DangerCircle[], graph: Graph): boolean {
  const n = graph.nodes[node];
  return zones.some(z => distanceMeters({ latitude: n.lat, longitude: n.lng }, { latitude: z.latitude, longitude: z.longitude }) < z.radius);
}

export function getOfflineSafeRoute(start: LatLng, end: LatLng, zones: DangerCircle[]): LatLng[] | null {
  const graph = getRoadGraph();

  // Find nearest graph nodes (simple linear search; data set is small for city sized export)
  let nearestStart: NodeId | null = null;
  let nearestEnd: NodeId | null = null;
  let bestStart = Infinity;
  let bestEnd = Infinity;
  for (const id in graph.nodes) {
    const n = graph.nodes[id];
    const dStart = distanceMeters(start, { latitude: n.lat, longitude: n.lng });
    if (dStart < bestStart) { bestStart = dStart; nearestStart = id; }
    const dEnd = distanceMeters(end, { latitude: n.lat, longitude: n.lng });
    if (dEnd < bestEnd) { bestEnd = dEnd; nearestEnd = id; }
  }
  if (!nearestStart || !nearestEnd) return null;

  // A* search
  const open = new Set<NodeId>();
  const gScore: Record<NodeId, number> = { [nearestStart]: 0 };
  const fScore: Record<NodeId, number> = { [nearestStart]: nodeDistance(nearestStart, nearestEnd, graph) };
  const cameFrom: Record<NodeId, NodeId | undefined> = {};

  open.add(nearestStart);

  while (open.size) {
    // node in open with smallest fScore
    let current: NodeId | null = null;
    let bestF = Infinity;
    for (const id of open) {
      const f = fScore[id] ?? Infinity;
      if (f < bestF) { bestF = f; current = id; }
    }
    if (!current) break;
    if (current === nearestEnd) {
      // reconstruct path
      const path: LatLng[] = [];
      let cur: NodeId | undefined = current;
      while (cur) {
        const n = graph.nodes[cur];
        path.push({ latitude: n.lat, longitude: n.lng });
        cur = cameFrom[cur];
      }
      return path.reverse();
    }

    open.delete(current);
    const curG = gScore[current] ?? Infinity;
    for (const edge of graph.edges[current] ?? []) {
      if (inDanger(edge.to, zones, graph)) continue;
      const tentativeG = curG + edge.distance;
      if (tentativeG < (gScore[edge.to] ?? Infinity)) {
        cameFrom[edge.to] = current;
        gScore[edge.to] = tentativeG;
        fScore[edge.to] = tentativeG + nodeDistance(edge.to, nearestEnd, graph);
        open.add(edge.to);
      }
    }
  }
  return null; // no route
}
