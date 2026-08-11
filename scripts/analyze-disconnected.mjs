// Diagnostic helper (not part of the build): for each sub-region, group its
// towns into connected components using real town-level adjacency, so we can
// tell genuinely split territory apart from a region that's one landmass but
// happens to include offshore islets.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import nodePath from 'node:path';
import { geoPath } from 'd3-geo';
import { merge, neighbors } from 'topojson-client';
import { SUBREGIONS } from './subregions.mjs';

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));
const topology = JSON.parse(
  readFileSync(nodePath.resolve(__dirname, '../node_modules/taiwan-atlas/towns-mercator-10t.json'), 'utf-8'),
);
const townGeoms = topology.objects.towns.geometries;
const pathGen = geoPath();

const idxByKey = new Map();
townGeoms.forEach((g, i) => idxByKey.set(`${g.properties.COUNTYNAME}|${g.properties.TOWNNAME}`, i));
const nbrs = neighbors(townGeoms);

for (const sub of SUBREGIONS) {
  const indices = sub.towns.map((t) => idxByKey.get(`${sub.county}|${t}`));
  const inSet = new Set(indices);
  const seen = new Set();
  const components = [];

  for (const start of indices) {
    if (seen.has(start)) continue;
    const comp = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop();
      comp.push(cur);
      for (const n of nbrs[cur]) {
        if (inSet.has(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    components.push(comp);
  }

  if (components.length > 1) {
    components.sort((a, b) => {
      const areaOf = (c) => pathGen.area(merge(topology, c.map((i) => townGeoms[i])));
      return areaOf(b) - areaOf(a);
    });
    console.log(`\n${sub.id}  ${sub.name}  -> ${components.length} disconnected group(s)`);
    for (const comp of components) {
      const names = comp.map((i) => townGeoms[i].properties.TOWNNAME);
      const area = pathGen.area(merge(topology, comp.map((i) => townGeoms[i]))).toFixed(1);
      console.log(`   [area ${area}] ${names.join('、')}`);
    }
  }
}
