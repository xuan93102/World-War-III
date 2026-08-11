// Build step: merges real townships (per taiwan-atlas) into the ~59
// sub-regions from docs/game-design.md section 3.1, and generates:
//  - polygon path / label position per sub-region
//  - real (town-level, rolled up) adjacency, logged for reference only
//  - a "mountain range" line mesh: the real shared borders between the
//    east-coast counties and everything else, used to draw the Central
//    Mountain Range divide on the map
// Re-run with `node scripts/build-map-data.mjs` if the sub-region set changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import nodePath from 'node:path';
import { geoPath } from 'd3-geo';
import { mesh, merge, neighbors } from 'topojson-client';
import { MOUNTAIN_PASSES, SUBREGIONS } from './subregions.mjs';

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));
const topologyPath = nodePath.resolve(
  __dirname,
  '../node_modules/taiwan-atlas/towns-mercator-10t.json',
);
const topology = JSON.parse(readFileSync(topologyPath, 'utf-8'));
const townGeoms = topology.objects.towns.geometries;

const TARGET_COUNTIES = new Set(SUBREGIONS.map((s) => s.county));

// --- validate: every township in our 19 target counties is claimed by
// exactly one sub-region, and every sub-region's towns actually exist. ---
const claimedBy = new Map(); // "county|town" -> subregion id
for (const sub of SUBREGIONS) {
  for (const town of sub.towns) {
    const key = `${sub.county}|${town}`;
    if (claimedBy.has(key)) {
      throw new Error(`${town}(${sub.county}) claimed by both ${claimedBy.get(key)} and ${sub.id}`);
    }
    claimedBy.set(key, sub.id);
  }
}
const realTownIndexByKey = new Map(); // "county|town" -> index into townGeoms
townGeoms.forEach((g, i) => {
  if (TARGET_COUNTIES.has(g.properties.COUNTYNAME)) {
    realTownIndexByKey.set(`${g.properties.COUNTYNAME}|${g.properties.TOWNNAME}`, i);
  }
});
for (const key of claimedBy.keys()) {
  if (!realTownIndexByKey.has(key)) throw new Error(`Unknown township: ${key} (typo?)`);
}
for (const key of realTownIndexByKey.keys()) {
  if (!claimedBy.has(key)) throw new Error(`Township ${key} exists in real data but isn't assigned to any sub-region`);
}
console.log(`Validated: ${realTownIndexByKey.size} real townships, all assigned exactly once.`);

// --- geometry: merge each sub-region's towns into one polygon ---
const pathGen = geoPath();

// Label anchor for a merged sub-region. A plain centroid of the whole shape
// lands in empty space when the sub-region is made of disconnected pieces
// (e.g. 仁武大社 also contains 小港區, which sits down by the harbour far from
// 仁武/大社 — the combined centroid fell in the water between them). Pick the
// single largest piece and centre the label in that one instead.
function labelPoint(merged) {
  if (merged.type !== 'MultiPolygon' || merged.coordinates.length < 2) {
    return pathGen.centroid(merged);
  }
  let best = null;
  let bestArea = -Infinity;
  for (const coords of merged.coordinates) {
    const piece = { type: 'Polygon', coordinates: coords };
    const area = pathGen.area(piece);
    if (area > bestArea) {
      bestArea = area;
      best = piece;
    }
  }
  return pathGen.centroid(best);
}

const subregionGeometry = SUBREGIONS.map((sub) => {
  const geoms = sub.towns.map((t) => townGeoms[realTownIndexByKey.get(`${sub.county}|${t}`)]);
  const merged = merge(topology, geoms);
  const [cx, cy] = labelPoint(merged);
  return {
    id: sub.id,
    name: sub.name,
    d: pathGen(merged),
    cx: Number(cx.toFixed(2)),
    cy: Number(cy.toFixed(2)),
    // Projected area, used by the engine to scale a region's food output and
    // its neutral garrison — bigger land is worth more and defends harder.
    area: Number(pathGen.area(merged).toFixed(1)),
  };
});

const allFeature = merge(
  topology,
  Array.from(realTownIndexByKey.values()).map((i) => townGeoms[i]),
);
const [[minX, minY], [maxX, maxY]] = pathGen.bounds(allFeature);

// --- real adjacency, rolled up from town-level to sub-region level (logged
// for reference only; gameplay adjacency stays hand-curated in regions.ts) ---
const subregionByTownIndex = new Map();
for (const sub of SUBREGIONS) {
  for (const t of sub.towns) subregionByTownIndex.set(realTownIndexByKey.get(`${sub.county}|${t}`), sub.id);
}
const rawNeighbors = neighbors(townGeoms);
const realAdjacency = new Map(); // subId -> Set<subId>
for (const sub of SUBREGIONS) realAdjacency.set(sub.id, new Set());
townGeoms.forEach((_, i) => {
  const subA = subregionByTownIndex.get(i);
  if (!subA) return;
  for (const j of rawNeighbors[i]) {
    const subB = subregionByTownIndex.get(j);
    if (subB && subB !== subA) realAdjacency.get(subA).add(subB);
  }
});

// --- curated gameplay adjacency: same-area edges keep the real geography;
// cross-area (west/east) edges are pruned to exactly the 5 named passes ---
const areaBySubId = Object.fromEntries(SUBREGIONS.map((s) => [s.id, s.area]));
for (const pass of MOUNTAIN_PASSES) {
  if (!realAdjacency.get(pass.from)?.has(pass.to)) {
    throw new Error(`Mountain pass "${pass.name}" (${pass.from} <-> ${pass.to}) is not a real geographic neighbor pair — check subregions.mjs`);
  }
}
const passPairs = new Set(MOUNTAIN_PASSES.flatMap((p) => [`${p.from}|${p.to}`, `${p.to}|${p.from}`]));
const curatedAdjacency = new Map();
for (const [id, set] of realAdjacency) {
  const kept = [...set].filter((other) => {
    const crossArea = (areaBySubId[id] === 'east') !== (areaBySubId[other] === 'east');
    return !crossArea || passPairs.has(`${id}|${other}`);
  });
  curatedAdjacency.set(id, kept);
}

// --- mountain range mesh: shared borders between 'east' sub-regions and
// every other area, restricted to our 19 target counties ---
const mountainMesh = mesh(topology, topology.objects.towns, (a, b) => {
  const subA = subregionByTownIndex.get(townGeoms.indexOf(a));
  const subB = subregionByTownIndex.get(townGeoms.indexOf(b));
  if (!subA || !subB) return false;
  return (areaBySubId[subA] === 'east') !== (areaBySubId[subB] === 'east');
});
const mountainRangePath = pathGen(mountainMesh);

// --- mountain pass crossing points ---
// Drawing each pass as a straight centroid-to-centroid line looked wrong: the
// two sub-regions' centroids can be far apart with unrelated territory in
// between (中橫's 東勢和平石岡 -> 秀林新城 line cut straight through
// 埔里魚池仁愛信義). Instead, find where the two regions actually touch and
// mark the crossing there: take the midpoint of their shared border and the
// border's local direction, so the map can draw a short "gate" segment
// crossing the ridge at the real corridor location.
const townIndexByGeom = new Map(townGeoms.map((g, i) => [g, i]));

function sharedBorderCrossing(fromId, toId) {
  const borderMesh = mesh(topology, topology.objects.towns, (a, b) => {
    const sa = subregionByTownIndex.get(townIndexByGeom.get(a));
    const sb = subregionByTownIndex.get(townIndexByGeom.get(b));
    if (!sa || !sb) return false;
    return (sa === fromId && sb === toId) || (sa === toId && sb === fromId);
  });
  const lines = borderMesh.coordinates.filter((line) => line.length >= 2);
  if (lines.length === 0) return null;

  // Longest shared segment = the main contact stretch (ignores slivers).
  let best = null;
  let bestLen = -Infinity;
  for (const line of lines) {
    let len = 0;
    for (let i = 1; i < line.length; i++) {
      len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    }
    if (len > bestLen) {
      bestLen = len;
      best = line;
    }
  }

  // Walk to the halfway point along that stretch.
  const half = bestLen / 2;
  let travelled = 0;
  for (let i = 1; i < best.length; i++) {
    const [x0, y0] = best[i - 1];
    const [x1, y1] = best[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (travelled + seg >= half) {
      const t = seg === 0 ? 0 : (half - travelled) / seg;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      // Crossing direction is perpendicular to the border's local tangent.
      const angle = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI + 90;
      return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), angle: Number(angle.toFixed(2)) };
    }
    travelled += seg;
  }
  return null;
}

const passesWithCrossings = MOUNTAIN_PASSES.map((pass) => {
  const crossing = sharedBorderCrossing(pass.from, pass.to);
  if (!crossing) {
    throw new Error(`Mountain pass "${pass.name}" has no shared border to place a crossing on`);
  }
  return { ...pass, ...crossing };
});

const output = `// AUTO-GENERATED by scripts/build-map-data.mjs — do not hand-edit.
// Source: taiwan-atlas (Ministry of the Interior boundary data), town level
// merged into the sub-regions defined in scripts/subregions.mjs.
//
// ADJACENCY is real geography EXCEPT across the west/east divide, which is
// pruned to exactly the 5 named mountain passes declared in subregions.mjs
// (docs/game-design.md 3.2) — see build-map-data.mjs for the curation rule.

export const MAP_BOUNDS = { minX: ${minX.toFixed(2)}, minY: ${minY.toFixed(2)}, maxX: ${maxX.toFixed(2)}, maxY: ${maxY.toFixed(2)} };

export interface RegionGeometry {
  id: string;
  name: string;
  area: 'north' | 'central' | 'south' | 'east';
  path: string;
  cx: number;
  cy: number;
  neighbors: string[];
  /** Projected land area; scales food output and neutral garrison size. */
  landArea: number;
}

export const REGION_GEOMETRY: RegionGeometry[] = ${JSON.stringify(
    subregionGeometry.map((g) => ({
      id: g.id,
      name: g.name,
      area: areaBySubId[g.id],
      path: g.d,
      cx: g.cx,
      cy: g.cy,
      neighbors: curatedAdjacency.get(g.id),
      landArea: g.area,
    })),
    null,
    2,
  )};

export interface MountainPass {
  from: string;
  to: string;
  name: string;
  /** Midpoint of the two regions' real shared border. */
  x: number;
  y: number;
  /** Crossing direction in degrees (perpendicular to the border there). */
  angle: number;
}

export const MOUNTAIN_PASSES: MountainPass[] = ${JSON.stringify(passesWithCrossings, null, 2)};

// Real shared borders between east-coast sub-regions and everything else —
// this traces the Central Mountain Range divide from actual county/town
// boundary data (those boundaries mostly follow the real ridgeline).
export const MOUNTAIN_RANGE_PATH = ${JSON.stringify(mountainRangePath)};
`;

writeFileSync(nodePath.resolve(__dirname, '../src/engine/mapData.generated.ts'), output);
console.log(`Wrote ${subregionGeometry.length} sub-regions.`);
console.log('\nCurated adjacency (real geography, cross-area pruned to the 5 passes):');
for (const [id, arr] of curatedAdjacency) console.log(` ${id} -> ${arr.join(', ')}`);
