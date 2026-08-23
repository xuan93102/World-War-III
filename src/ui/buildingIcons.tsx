import type { BuildingType } from '../engine/buildings';
import type { WonderId } from '../engine/maps';
import { shade } from './colors';

/**
 * One icon per building, plus one for a player's core.
 *
 * The same artwork renders two ways:
 *  - as a **badge** (a coloured card with a white solid on it), used in the
 *    build menu, the panels, and the flat 2D map, where a card reads best;
 *  - as a **solid** (the building itself, in its own colour, lit and shaded),
 *    used on the 3D map where it stands on the ground rather than floating.
 *
 * The 3D read comes from shading three faces of every volume, not from any
 * real 3D: at map size a genuine perspective model would turn to mush, and 63
 * regions' worth would cost far more than they're worth. Flat SVG stays crisp
 * at every zoom level.
 *
 * Everything is drawn in a 24x24 box, with the ground the solids stand on at
 * y = GROUND_Y, so callers can plant a model on the map by that line.
 */

export type IconKey = BuildingType | 'core' | WonderId;

/** Badge colours — picked to stay apart from each other and from the region
 *  fills, and to read on both the dark and light themes. */
const BUILDING_COLOR: Record<BuildingType, string> = {
  shop: '#e8a33d', // amber — trade
  housing: '#35b6a4', // teal
  farm: '#63b83d', // green — crops
  granary: '#b8912e', // dark gold — stored grain
  academy: '#d9534f', // red — military
  arsenal: '#7d8a99', // steel
  school: '#4a90d9', // blue — learning
  research: '#9b59d0', // purple — science
  fortress: '#8d7355', // stone brown
  trench: '#6b7a52', // dug earth and sandbags
  camp: '#7b8b5a', // canvas olive — a tent, not a building
  wonder: '#ffd54a', // bright gold — the win condition
};

/** Every map's landmark is its wonder, so they share the wonder's gold. */
const WONDER_COLOR: Record<WonderId, string> = {
  taipei101: '#ffd54a',
};

/** Fallback for a core with no owner; owned cores take the player's colour. */
const CORE_COLOR = '#ffd54a';

const ICON_OUTLINE = '#12161c';

/** Where a solid's footprint sits in the 24x24 box — its contact with the ground. */
export const GROUND_Y = 21;

/**
 * The four tones every volume is drawn with: a lit top, a mid-tone left face,
 * a shaded right face, and a darker tone for cut details (doorways, furrows,
 * silo bands). `edge` outlines each face so the geometry still reads once the
 * model is only a couple of dozen pixels tall.
 */
interface Palette {
  top: string;
  left: string;
  right: string;
  detail: string;
  edge: string;
}

function badgePalette(color: string): Palette {
  // White over the badge colour: the translucent faces let the colour through,
  // so the building reads as *that building's* colour rather than plain grey.
  return {
    top: 'rgba(255,255,255,1)',
    left: 'rgba(255,255,255,0.78)',
    right: 'rgba(255,255,255,0.5)',
    detail: color,
    edge: 'none',
  };
}

function solidPalette(color: string): Palette {
  return {
    top: shade(color, 0.38),
    left: color,
    right: shade(color, -0.34),
    detail: shade(color, -0.5),
    edge: ICON_OUTLINE,
  };
}

/**
 * An isometric box standing on the ground rhombus centred at (cx, groundY).
 * `hw` is its half-width; the rhombus is twice as wide as it is deep, so its
 * near and far points sit hw/2 above and below groundY.
 */
function isoBox(cx: number, groundY: number, hw: number, h: number, p: Palette) {
  const hh = hw / 2;
  const top = groundY - h;
  return (
    <>
      <path d={`M${cx} ${top - hh} L${cx + hw} ${top} L${cx} ${top + hh} L${cx - hw} ${top} Z`} fill={p.top} />
      <path d={`M${cx - hw} ${top} L${cx} ${top + hh} L${cx} ${groundY + hh} L${cx - hw} ${groundY} Z`} fill={p.left} />
      <path d={`M${cx + hw} ${top} L${cx} ${top + hh} L${cx} ${groundY + hh} L${cx + hw} ${groundY} Z`} fill={p.right} />
    </>
  );
}

/**
 * The glyph for each icon. Silhouettes are deliberately all different: at map
 * size the outline and the colour do the identifying, and the surface detail
 * only pays off up close.
 */
function glyph(key: IconKey, p: Palette) {
  switch (key) {
    case 'shop': // stall under a wide flat canopy
      return (
        <>
          {isoBox(12, 19.5, 5.5, 4, p)}
          {isoBox(12, 14.5, 8, 0.9, p)}
        </>
      );
    case 'housing': // house under a hipped roof
      return (
        <>
          {isoBox(12, 19, 6, 3, p)}
          <path d="M6 16 L12 19 L12 11.5 Z" fill={p.left} />
          <path d="M18 16 L12 19 L12 11.5 Z" fill={p.right} />
        </>
      );
    case 'farm': // ploughed field, furrows running with the grain
      return (
        <>
          {isoBox(12, 17, 8, 1.2, p)}
          <g stroke={p.detail} strokeWidth={0.9} strokeLinecap="round">
            <line x1="10" y1="12.8" x2="18" y2="16.8" />
            <line x1="8" y1="13.8" x2="16" y2="17.8" />
            <line x1="6" y1="14.8" x2="14" y2="18.8" />
          </g>
        </>
      );
    case 'granary': // domed silo
      return (
        <>
          <path d="M7 12 V19.5 A5 2.5 0 0 0 17 19.5 V12 Z" fill={p.left} />
          <path d="M12 12 H17 V19.5 A5 2.5 0 0 1 12 22 Z" fill={p.right} />
          <path d="M7 12 A5 5.4 0 0 1 17 12 Z" fill={p.top} />
          <g stroke={p.detail} strokeWidth={1} fill="none">
            <path d="M7.2 15 A5 2.5 0 0 0 16.8 15" />
            <path d="M7.2 17.6 A5 2.5 0 0 0 16.8 17.6" />
          </g>
        </>
      );
    case 'academy': // barracks under a flag
      return (
        <>
          {isoBox(12, 19, 6.5, 4.5, p)}
          <rect x="11.6" y="4" width="0.9" height="10.5" fill={p.top} />
          <path d="M12.5 4.6 L18 6.6 L12.5 8.6 Z" fill={p.top} />
        </>
      );
    case 'arsenal': // works with a tall chimney
      return (
        <>
          {isoBox(12, 19, 7, 3.5, p)}
          {isoBox(15.5, 13.5, 1.5, 6, p)}
        </>
      );
    case 'school': // mortarboard
      return (
        <>
          <path d="M8 13 V16.5 C8 19.8, 16 19.8, 16 16.5 V13 Z" fill={p.right} />
          {isoBox(12, 11, 9, 1.1, p)}
          <path d="M18.6 11.4 V16.4" stroke={p.top} strokeWidth={0.8} fill="none" />
          <circle cx="18.6" cy="17.2" r="1.2" fill={p.top} />
        </>
      );
    case 'research': // conical flask
      return (
        <>
          <path d="M10.3 4.5 H13.7 V9.5 L18.3 18.2 A6.4 3.2 0 0 1 5.7 18.2 Z" fill={p.left} />
          <path d="M12 4.5 H13.7 V9.5 L18.3 18.2 A6.4 3.2 0 0 1 12 21.4 Z" fill={p.right} />
          <ellipse cx="12" cy="4.5" rx="1.7" ry="0.7" fill={p.top} />
          <ellipse cx="9.4" cy="16" rx="1" ry="2.8" transform="rotate(18 9.4 16)" fill={p.top} />
        </>
      );
    case 'fortress': // twin gate towers over a curtain wall
      return (
        <>
          {isoBox(12, 19, 5, 4, p)}
          {isoBox(5.5, 19, 3, 7, p)}
          {isoBox(18.5, 19, 3, 7, p)}
          <path d="M9.6 19.4 V17.2 A2.4 2.4 0 0 1 12 17.2 V20.6 Z" fill={p.detail} />
        </>
      );
    case 'trench': // a cut in the ground behind a parapet of sandbags
      return (
        <>
          <path d="M2.5 18.5 H21.5 L18 22 H6 Z" fill={p.left} />
          <path d="M6 18.5 H18 L15.5 15.5 H8.5 Z" fill={p.detail} />
          {isoBox(6, 15.5, 3, 1.6, p)}
          {isoBox(18, 15.5, 3, 1.6, p)}
        </>
      );
    case 'camp': // ridge tent beside a crate
      return (
        <>
          <path d="M11 5.5 L3.5 19.4 H11 Z" fill={p.left} />
          <path d="M11 5.5 L18.5 19.4 H11 Z" fill={p.right} />
          <path d="M11 19.4 V13.4 L8 19.4 Z" fill={p.detail} />
          {isoBox(20, 20.4, 3.4, 2.4, p)}
        </>
      );
    case 'wonder': // stepped monument under a spire — a map with no landmark
      return (
        <>
          {isoBox(12, 19, 8, 1.5, p)}
          {isoBox(12, 17.5, 5.5, 2.5, p)}
          {isoBox(12, 15, 3.5, 3, p)}
          <path d="M8.5 12 L12 13.75 L12 3 Z" fill={p.left} />
          <path d="M15.5 12 L12 13.75 L12 3 Z" fill={p.right} />
        </>
      );
    case 'taipei101': {
      // What makes the building recognisable is not that it is tall — it is
      // that every section flares out into a cornice at its top, so the
      // silhouette is notched all the way up. The tower does *not* widen as it
      // rises; a stack that did would read as an upside-down pyramid.
      //
      // So each section is a narrow shaft with a wider, shallow lip on top of
      // it. Five of the real eight: past that the notches are finer than a
      // pixel at map size and the profile just turns to fuzz.
      const sections = [];
      let ground = 19.4;
      for (let i = 0; i < 5; i++) {
        sections.push(<g key={`shaft${i}`}>{isoBox(12, ground, 2.35, 2.2, p)}</g>);
        ground -= 2.2;
        sections.push(<g key={`lip${i}`}>{isoBox(12, ground, 3.05, 0.55, p)}</g>);
        ground -= 0.55;
      }
      return (
        <>
          {isoBox(12, 21, 4.9, 1.6, p)}
          {sections}
          <path d="M11.15 5.65 L12 6.1 L12 0.9 Z" fill={p.left} />
          <path d="M12.85 5.65 L12 6.1 L12 0.9 Z" fill={p.right} />
        </>
      );
    }
    case 'core': // citadel keep, crowned
      return (
        <>
          {isoBox(12, 19, 8, 2, p)}
          {isoBox(12, 17, 4.5, 5, p)}
          <path
            d="M12 1.8 L13.35 5.05 L16.6 6.4 L13.35 7.75 L12 11 L10.65 7.75 L7.4 6.4 L10.65 5.05 Z"
            fill={p.top}
          />
        </>
      );
  }
}

function colorFor(type: IconKey, override?: string): string {
  if (override) return override;
  if (type === 'core') return CORE_COLOR;
  return type in WONDER_COLOR
    ? WONDER_COLOR[type as WonderId]
    : BUILDING_COLOR[type as BuildingType];
}

interface BadgeProps {
  type: IconKey;
  /** Overrides the colour — used to tint a core with its owner's colour. */
  color?: string;
  /** Draws it hollow and dashed, for a building still going up. */
  underConstruction?: boolean;
  /** Outline width, in the 24x24 icon space. */
  strokeWidth?: number;
}

/**
 * Badge + glyph in raw 24x24 coordinates — no <svg> of its own, so it can be
 * dropped into the map's SVG under a transform or into a standalone one.
 */
export function BuildingBadge({ type, color, underConstruction = false, strokeWidth = 1.6 }: BadgeProps) {
  const fill = colorFor(type, color);
  return (
    <g>
      <rect
        x={strokeWidth / 2}
        y={strokeWidth / 2}
        width={24 - strokeWidth}
        height={24 - strokeWidth}
        rx={6}
        fill={fill}
        fillOpacity={underConstruction ? 0.35 : 1}
        stroke={ICON_OUTLINE}
        strokeWidth={strokeWidth}
        strokeDasharray={underConstruction ? '3 2.2' : undefined}
      />
      <g opacity={underConstruction ? 0.7 : 1}>{glyph(type, badgePalette(fill))}</g>
    </g>
  );
}

/**
 * The bare building, in its own colour, standing on y = GROUND_Y — no card
 * behind it. For the 3D map, where the model sits on the terrain itself.
 */
export function BuildingSolid({ type, color, underConstruction = false }: Omit<BadgeProps, 'strokeWidth'>) {
  const palette = solidPalette(colorFor(type, color));
  return (
    <g
      opacity={underConstruction ? 0.5 : 1}
      stroke={palette.edge}
      strokeWidth={0.5}
      strokeLinejoin="round"
      // Faces set their own fill; the shared thin edge is what keeps the
      // geometry legible once the model is only a couple of dozen pixels tall.
      strokeDasharray={underConstruction ? '1.6 1.2' : undefined}
    >
      {glyph(type, palette)}
    </g>
  );
}

/** Standalone icon for the build menu and status panels. */
export function BuildingIcon({ type, size = 22 }: { type: IconKey; size?: number }) {
  return (
    <svg className="building-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <BuildingBadge type={type} />
    </svg>
  );
}
