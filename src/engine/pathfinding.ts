import { REGIONS } from './regions';

const NEIGHBORS_BY_ID = new Map(REGIONS.map((r) => [r.id, r.neighbors]));

/**
 * Fewest region-to-region hops between two regions, following the curated
 * gameplay adjacency (so the 5 mountain passes are the only west/east links).
 * Returns Infinity if unreachable.
 */
export function regionDistance(fromId: string, toId: string): number {
  if (fromId === toId) return 0;
  const visited = new Set<string>([fromId]);
  let frontier = [fromId];
  let depth = 0;

  while (frontier.length > 0) {
    depth++;
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of NEIGHBORS_BY_ID.get(id) ?? []) {
        if (visited.has(n)) continue;
        if (n === toId) return depth;
        visited.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return Infinity;
}

/** Every region at least `minDistance` hops away from `fromId`. */
export function regionsAtLeastApart(fromId: string, minDistance: number): string[] {
  return REGIONS.filter((r) => r.id !== fromId && regionDistance(fromId, r.id) >= minDistance).map(
    (r) => r.id,
  );
}
