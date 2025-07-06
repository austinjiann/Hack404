// Build a lightweight road graph from GeoJSON exported via Overpass Turbo
// The file `osm_roads.json` should live in the project root (next to App.tsx)
// and must be added to the metro asset list implicitly by requiring it.
//
// Usage:
//   import { graph } from './graphBuilder';
//   graph.nodes, graph.edges

export type NodeId = string;
export interface Node {
  id: NodeId;
  lat: number;
  lng: number;
}

export interface Edge {
  from: NodeId;
  to: NodeId;
  distance: number; // meters
}

export interface Graph {
  nodes: Record<NodeId, Node>;
  edges: Record<NodeId, Edge[]>; // adjacency list
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dx = (lat1 - lat2) * 111_000;
  const dy = (lng1 - lng2) * 111_000 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(dx, dy);
}

function buildGraph(geojson: any): Graph {
  const nodes: Record<NodeId, Node> = {};
  const edges: Record<NodeId, Edge[]> = {};

  for (const feature of geojson.features as any[]) {
    if (feature.geometry.type !== 'LineString') continue;
    const coords: [number, number][] = feature.geometry.coordinates;
    for (let i = 0; i < coords.length; i++) {
      const [lng, lat] = coords[i];
      const id: NodeId = `${lat.toFixed(6)},${lng.toFixed(6)}`; // rounded to 1e-6 deg (~0.1m)
      if (!nodes[id]) nodes[id] = { id, lat, lng };
      if (i > 0) {
        const [plng, plat] = coords[i - 1];
        const pid: NodeId = `${plat.toFixed(6)},${plng.toFixed(6)}`;
        const dist = distanceMeters(lat, lng, plat, plng);
        if (!edges[pid]) edges[pid] = [];
        if (!edges[id]) edges[id] = [];
        edges[pid].push({ from: pid, to: id, distance: dist });
        edges[id].push({ from: id, to: pid, distance: dist });
      }
    }
  }

  return { nodes, edges };
}

// Lazy singleton build – the GeoJSON can be large, so defer until first use
let _graph: Graph | null = null;
export function getRoadGraph(): Graph {
  if (_graph) return _graph;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const geojson = require('./osm_roads.json');
    _graph = buildGraph(geojson);
  } catch {
    throw new Error('osm_roads.json not found or invalid. Please add it to project.');
  }
  return _graph!;
}
