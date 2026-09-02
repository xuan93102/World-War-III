import { useEffect, useRef } from 'react';
import { LAND_RINGS } from './globeData.generated';

/**
 * A slowly turning globe, behind the menus.
 *
 * It used to be Taiwan, which was true of the only map that exists and wrong
 * about where the game is going.
 *
 * The coastlines are real, projected orthographically at whatever the current
 * rotation is — this is a globe being turned, not a picture of one being
 * animated. Drawing them as *lines* rather than filled land is what keeps that
 * cheap: a filled polygon crossing the horizon has to be clipped against it,
 * whereas a line can simply stop when it goes round the back and start again
 * when it comes into view.
 */

/** Radius everything is drawn at; the viewBox is sized to match. */
const R = 100;

/** How far above the equator we are looking from. */
const TILT_DEGREES = 18;

/** Seconds for one full turn. Slow: this is a background, not a spinner. */
const SPIN_SECONDS = 120;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

const SIN_TILT = Math.sin(radians(TILT_DEGREES));
const COS_TILT = Math.cos(radians(TILT_DEGREES));

/**
 * A point on the unit sphere, worked out once.
 *
 * Turning the globe is then a rotation of these about the polar axis, which
 * is four multiplies a point — no trigonometry inside the loop, which is what
 * makes a few thousand points a frame free.
 */
type Vector = readonly [number, number, number];

function toVectors(ring: readonly (readonly [number, number])[]): Vector[] {
  return ring.map(([lon, lat]) => {
    const φ = radians(lat);
    const λ = radians(lon);
    const c = Math.cos(φ);
    return [c * Math.cos(λ), c * Math.sin(λ), Math.sin(φ)] as const;
  });
}

const LAND = LAND_RINGS.map(toVectors);

/** Meridians every 30°, parallels every 30°, as rings of their own. */
const GRATICULE: Vector[][] = (() => {
  const lines: (readonly [number, number])[][] = [];
  for (let lon = -180; lon < 180; lon += 30) {
    const meridian: [number, number][] = [];
    for (let lat = -80; lat <= 80; lat += 5) meridian.push([lon, lat]);
    lines.push(meridian);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const parallel: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 5) parallel.push([lon, lat]);
    lines.push(parallel);
  }
  return lines.map(toVectors);
})();

/**
 * Every ring, projected at this rotation, as one path.
 *
 * A point on the far side is simply left out and the line broken there, which
 * is why the outlines end cleanly at the limb without anything being clipped.
 */
function pathAt(rings: Vector[][], spin: number): string {
  const cos = Math.cos(spin);
  const sin = Math.sin(spin);
  let d = '';
  for (const ring of rings) {
    let drawing = false;
    for (const [x, y, z] of ring) {
      // Turn about the polar axis, then lean back by the viewing tilt.
      const rx = x * cos + y * sin;
      const ry = -x * sin + y * cos;
      const toward = rx * COS_TILT + z * SIN_TILT;
      if (toward <= 0) {
        drawing = false;
        continue;
      }
      const sx = (R * ry).toFixed(1);
      const sy = (-R * (z * COS_TILT - rx * SIN_TILT)).toFixed(1);
      d += `${drawing ? 'L' : 'M'}${sx} ${sy}`;
      drawing = true;
    }
  }
  return d;
}

export function GlobeSilhouette() {
  const land = useRef<SVGPathElement>(null);
  const grid = useRef<SVGPathElement>(null);

  useEffect(() => {
    const draw = (spin: number) => {
      if (land.current) land.current.setAttribute('d', pathAt(LAND, spin));
      if (grid.current) grid.current.setAttribute('d', pathAt(GRATICULE, spin));
    };

    // Somebody who has asked for less motion gets a globe, just not a turning
    // one. The rest of the drawing is identical.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      draw(0);
      return;
    }

    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      draw((((now - started) / 1000 / SPIN_SECONDS) % 1) * 2 * Math.PI);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <svg
      className="globe-silhouette"
      viewBox={`${-R - 6} ${-R - 6} ${(R + 6) * 2} ${(R + 6) * 2}`}
      aria-hidden="true"
      focusable="false"
    >
      <circle className="globe-limb" cx={0} cy={0} r={R} />
      <path ref={grid} className="globe-grid" />
      <path ref={land} className="globe-land" />
    </svg>
  );
}
