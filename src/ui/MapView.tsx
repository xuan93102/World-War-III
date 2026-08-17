import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { select } from 'd3-selection';
import 'd3-transition'; // side-effect: adds .transition() to d3-selection Selection
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomTransform } from 'd3-zoom';
import { garrisonAt, hasMountainRoad } from '../engine/regions';
import type { GameMap, MapBounds } from '../engine/maps';
import { totalUnits } from '../engine/units';
import { BuildingBadge, BuildingSolid, GROUND_Y, type IconKey } from './buildingIcons';
import { shade } from './colors';
import { useSettings } from '../settings/useSettings';
import { MAP_TILT, THEMES } from '../settings/types';
import type { GameState, PlayerState } from '../engine/types';

interface MapViewProps {
  gameState: GameState;
  players: PlayerState[];
  selectedRegionId: string | null;
  /** The map being played; supplies its own regions, passes and bounds. */
  map: GameMap;
  /** Regions a pending march would walk through, in order. */
  marchRoute: string[] | null;
  /** Where that route starts. */
  routeFrom: string | null;
  onSelectRegion: (regionId: string) => void;
}

// Label/marker colours that read the same on every theme.
const MILITIA_COLOR = '#ff8a80';
// On-screen size of a building badge, in pixels — divided by the zoom scale
// when drawn so it stays the same size however far you zoom, like the labels.
const BUILDING_BADGE_PX = 17;
// How far above the region's centroid the badge sits: enough to clear both the
// core ring (r=7) and the name label underneath it.
const BUILDING_BADGE_OFFSET_PX = 15;
const RIDGE_COLOR = '#8b6b4a';
// The extruded side of the island in 3D. Deliberately near-black rather than a
// shade of any theme: it reads as the shadowed cut face on every background.
const LAND_EDGE_COLOR = '#0b1016';
// Lit and shaded faces of the mountain peaks, from the same family as the
// ridge line they stand on.
const PEAK_LIT = '#a5825c';
const PEAK_SHADE = '#5f482f';
// Peaks are placed this far apart along the ridge, and vary between these
// heights — all in world units, so the range grows as you zoom into it the
// way real terrain would.
const PEAK_SPACING = 8;
const PEAK_MIN_H = 6;
const PEAK_MAX_H = 15;
// On-screen size of a building *model* on the 3D map. Much bigger than the flat
// 2D badge: it's the building itself now, not a marker standing in for one.
const BUILDING_MODEL_PX = 44;
// A pass is drawn as a road that actually crosses the range, not a marker
// sitting on it: the peaks are cleared away for PASS_GAP either side of the
// crossing (a pass *is* a gap in the mountains) and the road runs through the
// notch, well past the ridge on both sides.
const PASS_ROAD_LENGTH = 46;
const PASS_GAP = 15;
const PASS_DARK = '#9c5a20';
// Greyed out until 山地公路 is researched — see hasMountainRoad().
const PASS_LOCKED = '#767c85';
const PASS_LOCKED_DARK = '#41464d';
const MODEL_OUTLINE = '#12161c';
// On-screen diameter of the counter marking an army in transit.
const MARCH_MARKER_PX = 20;
// The dashed line previewing where a march would go.
const ROUTE_COLOR = '#ffd54a';
// A fight in progress.
const BATTLE_COLOR = '#d9342b';
const BATTLE_MARKER_PX = 24;
const PASS_COLOR = '#e08a3d';

const WORLD_PADDING = 20;
// How thick the island slab looks in 3D, in world units. Left in world units
// on purpose: a real extrusion should grow as you zoom in, the way the land
// itself does.
const LAND_DEPTH = 7;

// Everything below is parameterised by `tilt` — the vertical squash applied to
// the ground plane (1 in 2D, less in 3D; see MAP_TILT). Because the tilt is a
// transform on the world content, the world's *effective* height shrinks with
// it, and the fit/zoom/pan maths all have to work in those tilted units or the
// map ends up off-centre and pannable into empty space. At tilt = 1 every
// formula here reduces to exactly what it was before 3D existed.
function worldWidth(b: MapBounds): number {
  return b.maxX - b.minX + WORLD_PADDING * 2;
}

function worldHeight(b: MapBounds, tilt: number): number {
  return (b.maxY - b.minY) * tilt + WORLD_PADDING * 2;
}

// The pannable world region — also doubles as "how far out you can zoom",
// since scaleExtent's minimum is set to whatever scale exactly fits this
// extent into the viewport (see minScaleFor). d3-zoom's own translateExtent
// clamping then does the rest: at that minimum scale there's no slack to
// pan within (the extent exactly fills the viewport already), and panning
// only opens up once zoomed in — and even then never far enough to show
// space outside the map.
function worldExtent(b: MapBounds, tilt: number): [[number, number], [number, number]] {
  return [
    [b.minX - WORLD_PADDING, b.minY * tilt - WORLD_PADDING],
    [b.maxX + WORLD_PADDING, b.maxY * tilt + WORLD_PADDING],
  ];
}

function minScaleFor(b: MapBounds, width: number, height: number, tilt: number): number {
  return Math.min(width / worldWidth(b), height / worldHeight(b, tilt));
}

function fitTransform(b: MapBounds, width: number, height: number, tilt: number): ZoomTransform {
  const scale = minScaleFor(b, width, height, tilt);
  const tx = width / 2 - scale * ((b.minX + b.maxX) / 2);
  const ty = height / 2 - scale * (((b.minY + b.maxY) / 2) * tilt);
  return zoomIdentity.translate(tx, ty).scale(scale);
}

// d3-zoom's default constrain locks each axis independently: whichever axis
// the map doesn't yet fill at the current scale gets forced dead-center with
// zero drag room, and it only unlocks once *that* axis's content grows past
// the viewport. Taiwan's map is tall/narrow and a typical browser window is
// wide, so height "catches up" to the viewport almost immediately while
// width needs much more zoom — the map felt like it could only pan
// vertically. This replaces it with a symmetric version: both axes get the
// same treatment, sliding freely within whatever range keeps the map from
// showing blank space beyond its own edges (which, when the map is narrower
// than the viewport in one axis, just means it can slide between flush-left
// and flush-right instead of being pinned to the middle).
// Built per tilt, so the floor-scale test below measures against the same
// (possibly squashed) world the fit and scaleExtent were computed from.
function makePanConstrain(b: MapBounds, tilt: number) {
  return function panConstrain(
  transform: ZoomTransform,
  extent: [[number, number], [number, number]],
  translateExtent: [[number, number], [number, number]],
): ZoomTransform {
  const [[ex0, ey0], [ex1, ey1]] = extent;
  const [[wx0, wy0], [wx1, wy1]] = translateExtent;
  const k = transform.k;
  const viewW = ex1 - ex0;
  const viewH = ey1 - ey0;

  // At exactly the floor scale (fully zoomed out), force a dead center in
  // BOTH axes — "locked, can't pan at all" per the original ask — rather
  // than letting the slack axis's slide-range apply. Above the floor, the
  // slide-range formula below is what fixes the direction asymmetry.
  if (k <= minScaleFor(b, viewW, viewH, tilt) + 1e-6) {
    return zoomIdentity.translate(viewW / 2 - ((wx0 + wx1) / 2) * k, viewH / 2 - ((wy0 + wy1) / 2) * k).scale(k);
  }

  const txBounds = [viewW - wx1 * k, -wx0 * k].sort((a, b) => a - b);
  const tyBounds = [viewH - wy1 * k, -wy0 * k].sort((a, b) => a - b);

  const tx = Math.min(txBounds[1], Math.max(txBounds[0], transform.x));
  const ty = Math.min(tyBounds[1], Math.max(tyBounds[0], transform.y));

  return zoomIdentity.translate(tx, ty).scale(k);
  };
}

// The pan bounds have to track the CURRENT rotation: translateExtent is a
// static axis-aligned box, but rotating the map (which happens inside the
// pan/zoom group — see the rotation state comment below) changes what
// axis-aligned box actually bounds the visible content. Without this,
// panning after any rotation clamps against the map's *unrotated* footprint,
// which no longer matches what's on screen (e.g. at 90° the map's long
// north-south extent is now sideways, so the old vertical bound clamps
// horizontal panning instead, and vice versa).
function rotatedExtent(
  extent: [[number, number], [number, number]],
  angleDeg: number,
  pivot: { x: number; y: number },
): [[number, number], [number, number]] {
  const [[x0, y0], [x1, y1]] = extent;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ].map(([x, y]) => {
    const dx = x - pivot.x;
    const dy = y - pivot.y;
    return [pivot.x + dx * cos - dy * sin, pivot.y + dx * sin + dy * cos];
  });
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
}

export function MapView({
  gameState,
  players,
  selectedRegionId,
  map,
  marchRoute,
  routeFrom,
  onSelectRegion,
}: MapViewProps) {
  const { settings, t } = useSettings();
  const themeColors = THEMES[settings.theme];
  // Label text needs to contrast against the region fill, which is dark on
  // dark themes and light on the light theme.
  const isLightTheme = settings.theme === 'light';
  const labelFill = isLightTheme ? '#14181d' : '#fff';
  const labelHalo = isLightTheme ? '#ffffff' : '#000';
  const tilt = MAP_TILT[settings.mapMode];
  const is3D = settings.mapMode === '3d';
  // Sealed (and drawn grey) until 山地公路 is researched.
  const unlockedPasses = hasMountainRoad();

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomBehaviorRef = useRef<ReturnType<typeof zoom<SVGSVGElement, unknown>> | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  // Layout settles across a few ResizeObserver passes before the container
  // reaches its final size, so keep auto-fitting until the user actually
  // drives a zoom/pan themselves (sourceEvent is null for programmatic
  // transform() calls, non-null for real wheel/drag/touch input).
  const userHasInteracted = useRef(false);
  // The zoom behaviour is built once but needs the live tilt; see its
  // .constrain() below.
  const tiltRef = useRef(tilt);
  tiltRef.current = tilt;
  // Same reasoning as tiltRef: the zoom behaviour is built once, but the map
  // (and so its bounds) is a prop that can change.
  const boundsRef = useRef(map.bounds);
  boundsRef.current = map.bounds;

  // Rotation: right-click + drag, desktop-first. d3-zoom has no rotation
  // support built in, so this is tracked as separate state.
  //
  // The rotate <g> is nested INSIDE the pan/zoom <g> (rotation happens in
  // world-space, before pan/zoom, not after) rather than wrapping it. d3-zoom
  // computes drag deltas from raw on-screen pixel movement and assumes its
  // own transform maps directly to the screen; if rotation instead wrapped
  // the pan/zoom output, panning after any rotation would drag in the wrong
  // visual direction (rotated relative to the mouse) since d3-zoom would
  // have no idea a further rotation was being applied on top of it.
  //
  // The rotation pivot is fixed in world coordinates at the start of each
  // drag — the world point currently under the screen center — so spinning
  // still feels like "rotate what I'm looking at," not "rotate around the
  // map's fixed origin."
  const [showLabels, setShowLabels] = useState(true);

  const [rotation, setRotation] = useState(0);
  // The pivot is a snapshot taken once, when a rotate-drag *starts* (from
  // whatever's currently under the screen center) — NOT re-derived every
  // render from the live pan/zoom transform. It has to stay fixed through
  // ordinary panning/zooming between rotate-gestures: since the pivot feeds
  // directly into the rotate transform applied to world-space content
  // (`rotate(rotation, pivot.x, pivot.y)`), a pivot that silently drifted
  // every time `transform` changed would make the rotated content visibly
  // shift on every pan even when `rotation` itself wasn't changing — that
  // was the "panning after rotating feels weird" bug. Snapshotting only at
  // drag-start keeps it stable across pans while still re-anchoring to
  // wherever you're currently looking each time you start a new rotation.
  const [rotationPivot, setRotationPivot] = useState({
    x: (map.bounds.minX + map.bounds.maxX) / 2,
    y: (map.bounds.minY + map.bounds.maxY) / 2,
  });
  // centerX/centerY are cached once per drag (native pointermove can fire
  // far faster than the display refreshes — e.g. hundreds of times a
  // second on a high-poll-rate mouse — and getBoundingClientRect() forces a
  // synchronous layout, so recomputing it on every move was real, measurable
  // jank). pendingAngle/rafId throttle the resulting setRotation calls to
  // once per animation frame instead of once per raw event: React re-renders
  // ~59 region paths + labels on every rotation update, which is far more
  // render work per tick than the pointer events actually need.
  const rotateDrag = useRef<{
    startAngle: number;
    startRotation: number;
    centerX: number;
    centerY: number;
  } | null>(null);
  const pendingAngle = useRef<number | null>(null);
  const rafId = useRef<number | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 2) return;
      e.preventDefault();
      // setPointerCapture can throw (e.g. NotFoundError) if the browser
      // doesn't consider the pointer "active" for capture purposes — don't
      // let that abort the gesture, capture is a nice-to-have here (keeps
      // tracking the drag if it leaves the element) not a hard requirement.
      try {
        (e.target as Element).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      // Re-anchor to whatever world point is currently under the screen
      // center, then hold that fixed for the rest of the gesture (and any
      // panning that happens before the next rotation starts).
      //
      // Screen content is world -> rotate -> tilt -> pan/zoom, so finding that
      // point means undoing all three. Inverting the pan/zoom alone lands on a
      // point in *rotated* space, which is only the world point when the map
      // happens to be unrotated and flat.
      const centreX = (size.width / 2 - transform.x) / transform.k;
      const centreY = (size.height / 2 - transform.y) / transform.k / tilt;
      const unrotate = (-rotation * Math.PI) / 180;
      const cos = Math.cos(unrotate);
      const sin = Math.sin(unrotate);
      const ox = centreX - rotationPivot.x;
      const oy = centreY - rotationPivot.y;
      const pivot = {
        x: rotationPivot.x + ox * cos - oy * sin,
        y: rotationPivot.y + ox * sin + oy * cos,
      };

      // Moving the pivot without touching the angle teleports the map: every
      // point shifts by (I - R(angle))(new - old), because it's now being spun
      // about a different centre. That's zero while the map is unrotated, which
      // is why this only bit once you'd rotated and then panned — and it
      // compounded, so alternating the two walked the map off screen. Cancel it
      // with an equal and opposite pan, leaving the view exactly where it was.
      const shiftX = pivot.x - centreX;
      const shiftY = (pivot.y - centreY) * tilt;
      if (
        (Math.abs(shiftX) > 1e-9 || Math.abs(shiftY) > 1e-9) &&
        svgRef.current &&
        zoomBehaviorRef.current
      ) {
        select(svgRef.current).call(
          zoomBehaviorRef.current.transform,
          zoomIdentity
            .translate(transform.x - transform.k * shiftX, transform.y - transform.k * shiftY)
            .scale(transform.k),
        );
      }
      setRotationPivot(pivot);
      const rect = containerRef.current!.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const startAngle = (Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180) / Math.PI;
      rotateDrag.current = { startAngle, startRotation: rotation, centerX, centerY };
    },
    [rotation, rotationPivot.x, rotationPivot.y, size, transform, tilt],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = rotateDrag.current;
    if (!drag) return;
    const currentAngle = (Math.atan2(e.clientY - drag.centerY, e.clientX - drag.centerX) * 180) / Math.PI;
    pendingAngle.current = drag.startRotation + (currentAngle - drag.startAngle);
    if (rafId.current === null) {
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        if (pendingAngle.current !== null) setRotation(pendingAngle.current);
      });
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!rotateDrag.current) return;
    rotateDrag.current = null;
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
      // Flush whatever the last move computed so the final frame isn't lost.
      if (pendingAngle.current !== null) setRotation(pendingAngle.current);
    }
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Some environments (backgrounded/non-composited tabs, e.g. a hidden
    // preview pane) defer ResizeObserver's first callback indefinitely since
    // it's tied to the rendering update step, and even a synchronous layout
    // read can occasionally race a not-yet-laid-out first paint. Try reading
    // the size immediately, and retry shortly after if it's still zero,
    // rather than depending solely on the observer callback.
    const tryReadSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height });
      return rect.width > 0 && rect.height > 0;
    };
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    if (!tryReadSize()) retryTimer = setTimeout(tryReadSize, 100);
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(retryTimer);
    };
  }, []);

  // Create the zoom behavior exactly once. Recreating it on every resize (it
  // used to live in the size-dependent effect below) reset d3-zoom's
  // internally-tracked transform on each ResizeObserver tick, so gestures
  // and the +/- buttons ended up computing deltas against a stale baseline.
  useEffect(() => {
    if (!svgRef.current) return;
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .translateExtent(worldExtent(boundsRef.current, tiltRef.current))
      // Read the tilt through a ref rather than capturing it: this behaviour is
      // built exactly once, but the tilt changes whenever the map mode does.
      .constrain((tr, ext, tExt) => makePanConstrain(boundsRef.current, tiltRef.current)(tr, ext, tExt))
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (event.sourceEvent) userHasInteracted.current = true;
        setTransform(event.transform);
      });
    zoomBehaviorRef.current = zoomBehavior;
    const selection = select(svgRef.current);
    selection.call(zoomBehavior);
    return () => {
      selection.on('.zoom', null);
    };
  }, []);

  // Layout settles across a few ResizeObserver passes before the container
  // reaches its final size, so keep re-fitting to the (possibly still
  // changing) size until the user actually drives a zoom/pan themselves.
  // `extent`/`scaleExtent` are kept in sync with the live container size
  // here too — extent tells d3-zoom what the viewport actually is (needed
  // for translateExtent's clamping to work at all), and pinning
  // scaleExtent's minimum to the exact fit scale is what makes "zoomed
  // fully out" and "locked, can't pan" the same state.
  useEffect(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    if (size.width === 0 || size.height === 0) return;
    zoomBehaviorRef.current
      .extent([[0, 0], [size.width, size.height]])
      .scaleExtent([minScaleFor(map.bounds, size.width, size.height, tilt), 12]);
    if (userHasInteracted.current) return;
    const initial = fitTransform(map.bounds, size.width, size.height, tilt);
    select(svgRef.current).call(zoomBehaviorRef.current.transform, initial);
    setTransform(initial); // belt-and-suspenders alongside the event round-trip
  }, [size.width, size.height, tilt, map.bounds]);

  // Switching map mode changes the world's height under the camera, so the
  // old pan/zoom is no longer meaningful — refit. Unlike the effect above this
  // ignores `userHasInteracted`: the user asked for a different view of the
  // map, so re-framing it is the expected outcome, not an override of their
  // panning. Skipped on the first pass so 2D start-up keeps its normal path.
  const lastTilt = useRef(tilt);
  useEffect(() => {
    if (lastTilt.current === tilt) return;
    lastTilt.current = tilt;
    if (!svgRef.current || !zoomBehaviorRef.current || size.width === 0) return;
    // rotation/rotationPivot are read through the closure on purpose (same
    // reasoning as the rotation effect below) — this must not re-run on every
    // rotation, it just needs whatever angle is in effect when the mode flips.
    zoomBehaviorRef.current.translateExtent(rotatedExtent(worldExtent(map.bounds, tilt), rotation, rotationPivot));
    select(svgRef.current).call(
      zoomBehaviorRef.current.transform,
      fitTransform(map.bounds, size.width, size.height, tilt),
    );
  }, [tilt, size.width, size.height]);

  // Keep the pan bounds matched to the CURRENT rotation (see rotatedExtent's
  // comment for why). Re-applying `.transform()` with the transform we
  // already have forces d3-zoom to immediately re-run panConstrain against
  // the freshly-rotated bounds, so if the current pan position is no longer
  // valid under the new footprint it snaps back right away instead of only
  // getting corrected on the next pan/zoom gesture.
  useEffect(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    zoomBehaviorRef.current.translateExtent(rotatedExtent(worldExtent(map.bounds, tilt), rotation, rotationPivot));
    // `transform` (and `rotationPivot` as a whole object, vs. the .x/.y
    // primitives already in the deps below) are intentionally read via
    // closure, not listed as dependencies — this effect should only re-run
    // when rotation actually changes, not on every pan/zoom; it just needs
    // whatever the latest transform is at that moment, to re-validate it
    // against the new bounds. (oxlint's exhaustive-deps warning here is
    // expected and safe to ignore for this reason.)
    select(svgRef.current).call(zoomBehaviorRef.current.transform, transform);
  }, [rotation, rotationPivot.x, rotationPivot.y]);

  const zoomBy = useCallback((factor: number) => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    userHasInteracted.current = true;
    select(svgRef.current).transition().duration(200).call(zoomBehaviorRef.current.scaleBy, factor);
  }, []);

  const resetView = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current || size.width === 0) return;
    select(svgRef.current)
      .transition()
      .duration(200)
      .call(zoomBehaviorRef.current.transform, fitTransform(map.bounds, size.width, size.height, tilt));
    setRotation(0);
    setRotationPivot({
      x: (map.bounds.minX + map.bounds.maxX) / 2,
      y: (map.bounds.minY + map.bounds.maxY) / 2,
    });
  }, [size, tilt, map.bounds]);

  // Peak positions along the Central Mountain Range, sampled straight off the
  // ridge path so the relief follows the real divide rather than an invented
  // line. Measured on a detached <path>, once per map — a map's geometry never
  // changes, but which map is on screen can.
  // Heights come from a cheap integer hash of the index: deterministic (so the
  // range doesn't reshuffle on every render) but irregular enough to read as
  // terrain instead of a row of identical cones.
  const ridgePeaks = useMemo(() => {
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    probe.setAttribute('d', map.ridgePath);
    const total = probe.getTotalLength();
    if (!total) return [];
    const peaks: { x: number; y: number; h: number }[] = [];
    for (let d = 0, i = 0; d <= total; d += PEAK_SPACING, i++) {
      const pt = probe.getPointAtLength(d);
      // A pass is a *gap* in the range, so clear the peaks around each one and
      // let the road run through the notch. Without this the road would be
      // buried behind the very mountains it's supposed to cross.
      const blocked = map.passes.some(
        (pass) => Math.hypot(pass.x - pt.x, pass.y - pt.y) < PASS_GAP,
      );
      if (blocked) continue;
      const jitter = ((i * 2654435761) % 1024) / 1024;
      peaks.push({ x: pt.x, y: pt.y, h: PEAK_MIN_H + jitter * (PEAK_MAX_H - PEAK_MIN_H) });
    }
    return peaks;
  }, [map.ridgePath, map.passes]);

  // Maps a world point through the same rotate-then-tilt the ground plane gets,
  // so a billboard drawn at the result lands exactly on top of that spot on the
  // map while itself staying upright and unsquashed.
  const project = useCallback(
    (x: number, y: number) => {
      const rad = (rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = x - rotationPivot.x;
      const dy = y - rotationPivot.y;
      return {
        x: rotationPivot.x + dx * cos - dy * sin,
        y: (rotationPivot.y + dx * sin + dy * cos) * tilt,
      };
    },
    [rotation, rotationPivot.x, rotationPivot.y, tilt],
  );

  const colorByPlayer: Record<string, string> = {};
  for (const p of players) colorByPlayer[p.id] = p.color;

  return (
    <div
      ref={containerRef}
      className="map-view"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size.width || 1} ${size.height || 1}`}
        role="img"
        aria-label={t('game.title')}
        style={{ width: '100%', height: '100%', touchAction: 'none' }}
      >
        <g transform={transform.toString()}>
        {/* The island's thickness: the same region shapes, in one flat dark
            colour, offset straight down beneath the ground plane. Drawn as a
            single silhouette (they tile, so the union is the coastline) rather
            than per-region walls, which would show seams along every internal
            border. The offset sits OUTSIDE the tilt so "down" stays screen-down
            at any viewing angle. */}
        {is3D && (
          <g transform={`translate(0 ${LAND_DEPTH})`} pointerEvents="none">
            <g transform={`scale(1 ${tilt})`}>
              <g transform={`rotate(${rotation} ${rotationPivot.x} ${rotationPivot.y})`}>
                {map.regions.map((region) => (
                  <path key={region.id} d={region.path} fill={LAND_EDGE_COLOR} />
                ))}
              </g>
            </g>
          </g>
        )}
        <g transform={`scale(1 ${tilt})`}>
        <g transform={`rotate(${rotation} ${rotationPivot.x} ${rotationPivot.y})`}>
          {map.regions.map((region) => {
            const regionState = gameState.regions[region.id];
            const fill = regionState.owner
              ? colorByPlayer[regionState.owner]
              : themeColors.neutralRegion;
            const isSelected = region.id === selectedRegionId;
            // A player's territory is one flat colour, so a fixed grey border
            // disappeared into any solid block of it. Bordering owned ground
            // with a dark shade of its *own* colour keeps every internal line
            // visible no matter how much of the map one side holds.
            const stroke = isSelected
              ? labelFill
              : regionState.owner
                ? shade(fill, -0.5)
                : themeColors.regionStroke;
            return (
              <path
                key={region.id}
                d={region.path}
                fill={fill}
                stroke={stroke}
                strokeWidth={isSelected ? 3 : 1.5}
                // Constant width on screen regardless of zoom, rotation or the
                // 3D tilt. The tilt scales y but not x, which would otherwise
                // thin every north-south border to 62% of the east-west ones.
                vectorEffect="non-scaling-stroke"
                onClick={() => onSelectRegion(region.id)}
                style={{ cursor: 'pointer' }}
              />
            );
          })}

          {/* Central Mountain Range: real shared border between east-coast and
              every other sub-region, i.e. the actual west/east divide. */}
          <path
            d={map.ridgePath}
            fill="none"
            stroke={RIDGE_COLOR}
            strokeWidth={3 / transform.k}
            strokeOpacity={0.75}
            strokeLinecap="round"
            pointerEvents="none"
          />

        </g>
        </g>

        {/* Billboard layer. Labels and badges must always face the viewer, so
            they can't live inside the tilt/rotation groups — a rotated map
            would tip them over and the tilt would squash them. They sit here
            in plain pan/zoom space instead, each positioned by applying the
            same rotate-then-tilt to its anchor point by hand (see `project`).
            At rotation 0 and tilt 1 that's the identity, so 2D is unchanged. */}
        <g pointerEvents="none">
          {/* Mountain relief. Each peak is a two-faced cone standing on the
              ridge — lit on the left, shaded on the right, same light as the
              buildings. Drawn far-to-near so nearer peaks overlap the ones
              behind them, which is what makes it read as a range with depth
              rather than a row of triangles. */}
          {is3D &&
            ridgePeaks
              .map((peak) => ({ p: project(peak.x, peak.y), h: peak.h }))
              .sort((a, b) => a.p.y - b.p.y)
              .map(({ p, h }, i) => {
                const w = h * 0.55;
                return (
                  <g key={`peak-${i}`}>
                    <path d={`M${p.x - w} ${p.y} L${p.x} ${p.y - h} L${p.x} ${p.y} Z`} fill={PEAK_LIT} />
                    <path d={`M${p.x + w} ${p.y} L${p.x} ${p.y - h} L${p.x} ${p.y} Z`} fill={PEAK_SHADE} />
                  </g>
                );
              })}

          {/* A gateway planted on the crossing: two posts under a lintel, same
              three-tone shading as the buildings. Stands on GROUND_Y like they
              do, so it sits on the terrain rather than floating over it. */}
          {map.passes.map((pass) => {
            // Both ends of the road in world space, then projected — so the
            // road lies *on* the ground and foreshortens with it, unlike the
            // labels and buildings which stand up off it.
            const rad = (pass.angle * Math.PI) / 180;
            const half = PASS_ROAD_LENGTH / 2;
            const a = project(pass.x - Math.cos(rad) * half, pass.y - Math.sin(rad) * half);
            const b = project(pass.x + Math.cos(rad) * half, pass.y + Math.sin(rad) * half);
            const mid = project(pass.x, pass.y);
            const deck = unlockedPasses ? PASS_COLOR : PASS_LOCKED;
            const edge = unlockedPasses ? PASS_DARK : PASS_LOCKED_DARK;
            const width = 7 / transform.k;
            return (
              <g key={pass.name}>
                {/* Offset copy underneath gives the roadbed thickness. */}
                <line
                  x1={a.x}
                  y1={a.y + width * 0.5}
                  x2={b.x}
                  y2={b.y + width * 0.5}
                  stroke={edge}
                  strokeWidth={width}
                  strokeLinecap="round"
                />
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={deck}
                  strokeWidth={width}
                  strokeLinecap="round"
                />
                {/* Kerbs, so the deck reads as a road rather than a bare bar. */}
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={MODEL_OUTLINE}
                  strokeWidth={width}
                  strokeLinecap="round"
                  strokeOpacity={0.22}
                  strokeDasharray={`${width * 0.9} ${width * 0.9}`}
                />
                <text
                  x={mid.x}
                  y={mid.y - width - 4 / transform.k}
                  textAnchor="middle"
                  fontSize={9 / transform.k}
                  fill={deck}
                  style={{ paintOrder: 'stroke', stroke: labelHalo, strokeWidth: 2.5 / transform.k, strokeOpacity: 0.7 }}
                >
                  {pass.name}
                </text>
              </g>
            );
          })}

          {/* The route a pending march would walk, drawn stop by stop so it's
              clear the column passes through real ground rather than jumping
              to the far end. */}
          {routeFrom && marchRoute && marchRoute.length > 0 && (
            <g pointerEvents="none">
              {marchRoute.map((step, i) => {
                const prev = i === 0 ? routeFrom : marchRoute[i - 1];
                const a = project(map.region(prev).cx, map.region(prev).cy);
                const b = project(map.region(step).cx, map.region(step).cy);
                return (
                  <g key={step}>
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={ROUTE_COLOR}
                      strokeWidth={3 / transform.k}
                      strokeDasharray={`${5 / transform.k} ${4 / transform.k}`}
                      strokeLinecap="round"
                    />
                    <circle cx={b.x} cy={b.y} r={3 / transform.k} fill={ROUTE_COLOR} />
                  </g>
                );
              })}
            </g>
          )}

          {/* Fights in progress (docs 6.2), so a contested region is obvious
              from the map rather than only from the panel. */}
          {gameState.battles.map((battle) => {
            const region = map.region(battle.regionId);
            const p = project(region.cx, region.cy);
            const r = BATTLE_MARKER_PX / transform.k / 2;
            return (
              <g key={`battle-${battle.regionId}`}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r}
                  fill={BATTLE_COLOR}
                  stroke={MODEL_OUTLINE}
                  strokeWidth={1.4 / transform.k}
                />
                <text
                  x={p.x}
                  y={p.y + r * 0.58}
                  textAnchor="middle"
                  fontSize={(BATTLE_MARKER_PX * 0.78) / transform.k}
                  fill="#fff"
                >
                  ⚔
                </text>
              </g>
            );
          })}

          {/* Armies on the road (docs 8). Drawn at the point they've actually
              reached between the two regions, so march time is something you
              watch rather than a number in a panel. */}
          {gameState.marches.map((march) => {
            const from = map.region(march.from);
            const to = map.region(march.to);
            const progress = 1 - march.remainingSeconds / march.totalSeconds;
            const p = project(
              from.cx + (to.cx - from.cx) * progress,
              from.cy + (to.cy - from.cy) * progress,
            );
            const r = MARCH_MARKER_PX / transform.k / 2;
            const color = colorByPlayer[march.playerId] ?? MILITIA_COLOR;
            return (
              <g key={march.id}>
                <circle cx={p.x} cy={p.y} r={r} fill={color} stroke={MODEL_OUTLINE} strokeWidth={1.2 / transform.k} />
                <text
                  x={p.x}
                  y={p.y + r * 0.62}
                  textAnchor="middle"
                  fontSize={(MARCH_MARKER_PX * 0.62) / transform.k}
                  fill="#fff"
                  fontWeight={700}
                >
                  {totalUnits(march.units)}
                </text>
              </g>
            );
          })}

          {map.regions.map((region) => ({ region, p: project(region.cx, region.cy) }))
            // Near regions last, so a building in front overlaps the one behind
            // it instead of the other way round. Only matters in 3D, where the
            // models have height; in 2D nothing overlaps.
            .sort((a, b) => (is3D ? a.p.y - b.p.y : 0))
            .map(({ region, p }) => {
            const regionState = gameState.regions[region.id];
            return (
              <g key={`label-${region.id}`}>
                {/* What stands on this ground: the core (tinted with its owner's
                    colour) and whatever building is here, translucent while it's
                    still going up. A core region can hold a building too, so they
                    sit side by side. In 3D these are the buildings themselves,
                    planted on the terrain; in 2D they're badges above the label. */}
                {(() => {
                  const badges: { key: IconKey; color?: string; dashed?: boolean }[] = [];
                  if (regionState.isCore) {
                    badges.push({
                      key: 'core',
                      color: regionState.owner ? colorByPlayer[regionState.owner] : undefined,
                    });
                  }
                  const built = regionState.building?.type ?? regionState.construction?.type;
                  if (built) badges.push({ key: built, dashed: !regionState.building });
                  if (badges.length === 0) return null;

                  const size = (is3D ? BUILDING_MODEL_PX : BUILDING_BADGE_PX) / transform.k;
                  const scale = size / 24;
                  const gap = size * (is3D ? 0.02 : 0.15);
                  const total = badges.length * size + (badges.length - 1) * gap;
                  // 3D plants the model's footprint on the centroid; 2D floats
                  // the badge above it, clear of the name label underneath.
                  const y = is3D
                    ? p.y - GROUND_Y * scale
                    : p.y - BUILDING_BADGE_OFFSET_PX / transform.k - size / 2;
                  return badges.map((badge, i) => {
                    const x = p.x - total / 2 + i * (size + gap);
                    return (
                      <g key={badge.key}>
                        {/* Contact shadow, squashed by the tilt so it lies on
                            the ground rather than standing up with the model. */}
                        {is3D && (
                          <ellipse
                            cx={x + size / 2}
                            cy={p.y}
                            rx={size * 0.3}
                            ry={size * 0.3 * tilt}
                            fill="#000"
                            opacity={0.28}
                          />
                        )}
                        <g transform={`translate(${x} ${y}) scale(${scale})`}>
                          {is3D ? (
                            <BuildingSolid type={badge.key} color={badge.color} underConstruction={badge.dashed} />
                          ) : (
                            <BuildingBadge type={badge.key} color={badge.color} underConstruction={badge.dashed} />
                          )}
                        </g>
                      </g>
                    );
                  });
                })()}
                {showLabels && (
                  <text
                    x={p.x}
                    y={p.y + 3.5 / transform.k}
                    textAnchor="middle"
                    fontSize={11 / transform.k}
                    fill={labelFill}
                    style={{ paintOrder: 'stroke', stroke: labelHalo, strokeWidth: 2.5 / transform.k, strokeOpacity: 0.7 }}
                  >
                    {region.name}
                  </text>
                )}
                {/* Neutral garrison strength, so contested ground and the
                    undefended land near each core read at a glance. */}
                {regionState.owner === null && totalUnits(garrisonAt(gameState, region.id)) > 0 && (
                  <text
                    x={p.x}
                    y={p.y + (showLabels ? 13 : 4) / transform.k}
                    textAnchor="middle"
                    fontSize={8 / transform.k}
                    fill={MILITIA_COLOR}
                    style={{ paintOrder: 'stroke', stroke: labelHalo, strokeWidth: 2 / transform.k, strokeOpacity: 0.7 }}
                  >
                    ⚔{totalUnits(garrisonAt(gameState, region.id))}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        </g>
      </svg>

      <div className="map-legend">
        <span className="map-legend-item">
          <span className="map-legend-swatch map-legend-mountain" />
          {t('game.mountainRange')}
        </span>
        <span className="map-legend-item">
          <span className="map-legend-swatch map-legend-pass" />
          {t('game.mountainPass')}
        </span>
      </div>

      <div className="map-zoom-controls">
        <button onClick={() => zoomBy(1.5)} aria-label={t('game.zoomIn')} title={t('game.zoomIn')}>+</button>
        <button onClick={() => zoomBy(1 / 1.5)} aria-label={t('game.zoomOut')} title={t('game.zoomOut')}>−</button>
        <button onClick={resetView} aria-label={t('game.resetView')} title={t('game.resetView')}>⤾</button>
        <button
          onClick={() => setShowLabels((v) => !v)}
          aria-label={showLabels ? t('game.hideLabels') : t('game.showLabels')}
          aria-pressed={showLabels}
          title={showLabels ? t('game.hideLabels') : t('game.showLabels')}
          className={showLabels ? 'is-active' : undefined}
        >
          A
        </button>
      </div>
    </div>
  );
}
