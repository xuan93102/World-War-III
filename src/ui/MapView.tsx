import { useCallback, useEffect, useRef, useState } from 'react';
import { select } from 'd3-selection';
import 'd3-transition'; // side-effect: adds .transition() to d3-selection Selection
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomTransform } from 'd3-zoom';
import { MAP_BOUNDS, MOUNTAIN_RANGE_PATH } from '../engine/mapData.generated';
import { REGIONS, MOUNTAIN_PASSES } from '../engine/regions';
import { totalUnits } from '../engine/units';
import { useSettings } from '../settings/useSettings';
import { THEMES } from '../settings/types';
import type { GameState, PlayerState } from '../engine/types';

interface MapViewProps {
  gameState: GameState;
  players: PlayerState[];
  selectedRegionId: string | null;
  onSelectRegion: (regionId: string) => void;
}

// Label/marker colours that read the same on every theme.
const CORE_RING = '#ffd54a';
const BUILDING_MARKER = '#ffffff';
const MILITIA_COLOR = '#ff8a80';
const RIDGE_COLOR = '#8b6b4a';
const PASS_COLOR = '#e08a3d';
// Length of the pass "gate" marker, in world units — deliberately fixed to
// the map rather than the screen, so the marker stays tied to the real
// geographic width of the corridor as you zoom.
const PASS_GATE_LENGTH = 22;

const WORLD_PADDING = 20;
const WORLD_WIDTH = MAP_BOUNDS.maxX - MAP_BOUNDS.minX + WORLD_PADDING * 2;
const WORLD_HEIGHT = MAP_BOUNDS.maxY - MAP_BOUNDS.minY + WORLD_PADDING * 2;
// The pannable world region — also doubles as "how far out you can zoom",
// since scaleExtent's minimum is set to whatever scale exactly fits this
// extent into the viewport (see minScaleFor). d3-zoom's own translateExtent
// clamping then does the rest: at that minimum scale there's no slack to
// pan within (the extent exactly fills the viewport already), and panning
// only opens up once zoomed in — and even then never far enough to show
// space outside the map.
const WORLD_EXTENT: [[number, number], [number, number]] = [
  [MAP_BOUNDS.minX - WORLD_PADDING, MAP_BOUNDS.minY - WORLD_PADDING],
  [MAP_BOUNDS.maxX + WORLD_PADDING, MAP_BOUNDS.maxY + WORLD_PADDING],
];

function minScaleFor(width: number, height: number): number {
  return Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
}

function fitTransform(width: number, height: number): ZoomTransform {
  const scale = minScaleFor(width, height);
  const tx = width / 2 - scale * (MAP_BOUNDS.minX + WORLD_WIDTH / 2 - WORLD_PADDING);
  const ty = height / 2 - scale * (MAP_BOUNDS.minY + WORLD_HEIGHT / 2 - WORLD_PADDING);
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
function panConstrain(
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
  if (k <= minScaleFor(viewW, viewH) + 1e-6) {
    return zoomIdentity.translate(viewW / 2 - ((wx0 + wx1) / 2) * k, viewH / 2 - ((wy0 + wy1) / 2) * k).scale(k);
  }

  const txBounds = [viewW - wx1 * k, -wx0 * k].sort((a, b) => a - b);
  const tyBounds = [viewH - wy1 * k, -wy0 * k].sort((a, b) => a - b);

  const tx = Math.min(txBounds[1], Math.max(txBounds[0], transform.x));
  const ty = Math.min(tyBounds[1], Math.max(tyBounds[0], transform.y));

  return zoomIdentity.translate(tx, ty).scale(k);
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

export function MapView({ gameState, players, selectedRegionId, onSelectRegion }: MapViewProps) {
  const { settings, t } = useSettings();
  const themeColors = THEMES[settings.theme];
  // Label text needs to contrast against the region fill, which is dark on
  // dark themes and light on the light theme.
  const isLightTheme = settings.theme === 'light';
  const labelFill = isLightTheme ? '#14181d' : '#fff';
  const labelHalo = isLightTheme ? '#ffffff' : '#000';

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
    x: (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) / 2,
    y: (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) / 2,
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
      // center, using the pan/zoom transform in effect right now — then
      // hold that fixed for the rest of the gesture (and any panning that
      // happens before the next rotation starts).
      setRotationPivot({
        x: (size.width / 2 - transform.x) / transform.k,
        y: (size.height / 2 - transform.y) / transform.k,
      });
      const rect = containerRef.current!.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const startAngle = (Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180) / Math.PI;
      rotateDrag.current = { startAngle, startRotation: rotation, centerX, centerY };
    },
    [rotation, size, transform],
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
      .translateExtent(WORLD_EXTENT)
      .constrain(panConstrain)
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
      .scaleExtent([minScaleFor(size.width, size.height), 12]);
    if (userHasInteracted.current) return;
    const initial = fitTransform(size.width, size.height);
    select(svgRef.current).call(zoomBehaviorRef.current.transform, initial);
    setTransform(initial); // belt-and-suspenders alongside the event round-trip
  }, [size.width, size.height]);

  // Keep the pan bounds matched to the CURRENT rotation (see rotatedExtent's
  // comment for why). Re-applying `.transform()` with the transform we
  // already have forces d3-zoom to immediately re-run panConstrain against
  // the freshly-rotated bounds, so if the current pan position is no longer
  // valid under the new footprint it snaps back right away instead of only
  // getting corrected on the next pan/zoom gesture.
  useEffect(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    zoomBehaviorRef.current.translateExtent(rotatedExtent(WORLD_EXTENT, rotation, rotationPivot));
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
      .call(zoomBehaviorRef.current.transform, fitTransform(size.width, size.height));
    setRotation(0);
    setRotationPivot({
      x: (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) / 2,
      y: (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) / 2,
    });
  }, [size]);

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
        <g transform={`rotate(${rotation} ${rotationPivot.x} ${rotationPivot.y})`}>
          {REGIONS.map((region) => {
            const regionState = gameState.regions[region.id];
            const fill = regionState.owner
              ? colorByPlayer[regionState.owner]
              : themeColors.neutralRegion;
            const isSelected = region.id === selectedRegionId;
            return (
              <path
                key={region.id}
                d={region.path}
                fill={fill}
                stroke={isSelected ? labelFill : themeColors.regionStroke}
                strokeWidth={(isSelected ? 2 : 0.6) / transform.k}
                onClick={() => onSelectRegion(region.id)}
                style={{ cursor: 'pointer' }}
              />
            );
          })}

          {/* Central Mountain Range: real shared border between east-coast and
              every other sub-region, i.e. the actual west/east divide. */}
          <path
            d={MOUNTAIN_RANGE_PATH}
            fill="none"
            stroke={RIDGE_COLOR}
            strokeWidth={3 / transform.k}
            strokeOpacity={0.75}
            strokeLinecap="round"
            pointerEvents="none"
          />

          {/* Each pass is drawn as a short "gate" crossing the ridge at the
              real midpoint of the two regions' shared border (see the
              crossing-point calc in scripts/build-map-data.mjs), rather than
              a long centroid-to-centroid line that cut across unrelated
              territory on its way. */}
          <g stroke={PASS_COLOR} fill="none" pointerEvents="none" strokeLinecap="round">
            {MOUNTAIN_PASSES.map((pass) => {
              const half = PASS_GATE_LENGTH / 2;
              const rad = (pass.angle * Math.PI) / 180;
              const dx = Math.cos(rad) * half;
              const dy = Math.sin(rad) * half;
              return (
                <line
                  key={pass.name}
                  x1={pass.x - dx}
                  y1={pass.y - dy}
                  x2={pass.x + dx}
                  y2={pass.y + dy}
                  strokeWidth={3.5 / transform.k}
                />
              );
            })}
          </g>
          <g pointerEvents="none">
            {MOUNTAIN_PASSES.map((pass) => (
              <text
                key={pass.name}
                x={pass.x}
                y={pass.y - (PASS_GATE_LENGTH / 2 + 4 / transform.k)}
                textAnchor="middle"
                fontSize={9 / transform.k}
                fill={PASS_COLOR}
                style={{ paintOrder: 'stroke', stroke: labelHalo, strokeWidth: 2.5 / transform.k, strokeOpacity: 0.7 }}
              >
                {pass.name}
              </text>
            ))}
          </g>

          {REGIONS.map((region) => {
            const regionState = gameState.regions[region.id];
            return (
              <g key={`label-${region.id}`} pointerEvents="none">
                {regionState.isCore && (
                  <circle cx={region.cx} cy={region.cy} r={7 / transform.k} fill="none" stroke={CORE_RING} strokeWidth={2 / transform.k} />
                )}
                {/* Building marker: filled square once complete, hollow while
                    still under construction. */}
                {(regionState.building || regionState.construction) && (
                  <rect
                    x={region.cx - 3 / transform.k}
                    y={region.cy - (showLabels ? 11 : 3) / transform.k}
                    width={6 / transform.k}
                    height={6 / transform.k}
                    fill={regionState.building ? BUILDING_MARKER : 'none'}
                    stroke={BUILDING_MARKER}
                    strokeWidth={1.2 / transform.k}
                    strokeDasharray={regionState.construction ? `${2 / transform.k} ${1.5 / transform.k}` : undefined}
                  />
                )}
                {showLabels && (
                  <text
                    x={region.cx}
                    y={region.cy + 3.5 / transform.k}
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
                {regionState.owner === null && totalUnits(regionState.units) > 0 && (
                  <text
                    x={region.cx}
                    y={region.cy + (showLabels ? 13 : 4) / transform.k}
                    textAnchor="middle"
                    fontSize={8 / transform.k}
                    fill={MILITIA_COLOR}
                    style={{ paintOrder: 'stroke', stroke: labelHalo, strokeWidth: 2 / transform.k, strokeOpacity: 0.7 }}
                  >
                    ⚔{totalUnits(regionState.units)}
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
