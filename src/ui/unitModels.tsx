import { shade } from './colors';
import { INFANTRY_STEPS, VEHICLE_STEPS, tierFor, type Tier } from './unitTiers';

/**
 * What a force looks like standing on the ground (docs/game-design.md 6.1).
 *
 * A number in a circle says how many; it does not say *what*. These say what:
 * armour in front, infantry behind it, each counted on its own so a column
 * that takes delivery of more tanks grows more tanks without its infantry
 * changing. Three sizes each — a section, a platoon, a battalion — because a
 * model per soldier would be unreadable long before it was accurate, and one
 * model for any number says nothing at all.
 *
 * Drawn with the same three lit faces as the buildings, so an army and a
 * barracks look like they belong on the same board.
 */

const OUTLINE = '#12161c';

interface Faces {
  top: string;
  left: string;
  right: string;
  dark: string;
}

function faces(color: string): Faces {
  return {
    top: shade(color, 0.4),
    left: color,
    right: shade(color, -0.34),
    dark: shade(color, -0.55),
  };
}

/**
 * A box standing on the ground rhombus centred at (cx, groundY) — the same
 * construction the buildings use, so everything on the map is lit from the
 * same direction.
 */
function box(cx: number, groundY: number, hw: number, h: number, f: Faces, depth = 0.5) {
  const hh = hw * depth;
  const top = groundY - h;
  return (
    <>
      <path
        d={`M${cx} ${top - hh} L${cx + hw} ${top} L${cx} ${top + hh} L${cx - hw} ${top} Z`}
        fill={f.top}
      />
      <path
        d={`M${cx - hw} ${top} L${cx} ${top + hh} L${cx} ${groundY + hh} L${cx - hw} ${groundY} Z`}
        fill={f.left}
      />
      <path
        d={`M${cx + hw} ${top} L${cx} ${top + hh} L${cx} ${groundY + hh} L${cx + hw} ${groundY} Z`}
        fill={f.right}
      />
    </>
  );
}

/** One soldier: shoulders, head, and a rifle held across the body. */
function Soldier({ x, ground, f }: { x: number; ground: number; f: Faces }) {
  return (
    <g>
      {box(x, ground, 1.5, 3.4, f)}
      <circle cx={x} cy={ground - 4.5} r={1.15} fill={f.top} stroke={OUTLINE} strokeWidth={0.3} />
      <line
        x1={x - 1.9}
        y1={ground - 2.4}
        x2={x + 1.9}
        y2={ground - 3.5}
        stroke={f.dark}
        strokeWidth={0.55}
        strokeLinecap="round"
      />
    </g>
  );
}

/** One tank: a low hull, a turret set back, and a gun over the front. */
function Tank({ x, ground, f }: { x: number; ground: number; f: Faces }) {
  return (
    <g>
      {box(x, ground, 3.2, 1.5, f, 0.42)}
      {box(x + 0.5, ground - 1.5, 1.7, 1.3, f, 0.42)}
      <line
        x1={x - 0.6}
        y1={ground - 2.5}
        x2={x - 4.6}
        y2={ground - 2.9}
        stroke={f.dark}
        strokeWidth={0.7}
        strokeLinecap="round"
      />
    </g>
  );
}

/** Where each model in a group of one, two or three stands. */
function spread(tier: Tier): { x: number; ground: number }[] {
  if (tier === 1) return [{ x: 0, ground: 0 }];
  if (tier === 2) {
    return [
      { x: -2.6, ground: -0.5 },
      { x: 2.6, ground: 0.5 },
    ];
  }
  // Three sit in a shallow wedge so the group has a front and a back rather
  // than being a row of identical things.
  return [
    { x: -4.4, ground: -0.9 },
    { x: 4.4, ground: 0.1 },
    { x: 0, ground: 1.1 },
  ];
}

interface TroopModelsProps {
  infantry: number;
  vehicles: number;
  color: string;
  /** Height of one model, in world units. */
  scale: number;
}

/**
 * A force, planted at the origin. Armour stands in front of the infantry —
 * in front meaning nearer the viewer, which on a tilted map is further down
 * the screen — and the two groups are sized from their own counts, so
 * neither moves when the other changes.
 */
export function TroopModels({ infantry, vehicles, color, scale }: TroopModelsProps) {
  const f = faces(color);
  const armour = vehicles > 0 ? tierFor(vehicles, VEHICLE_STEPS) : null;
  const foot = infantry > 0 ? tierFor(infantry, INFANTRY_STEPS) : null;

  return (
    <g transform={`scale(${scale / 6})`} stroke={OUTLINE} strokeWidth={0.28} strokeLinejoin="round">
      {foot !== null && (
        <g transform={vehicles > 0 ? 'translate(0 -3.6)' : ''}>
          {spread(foot).map((at, i) => (
            <Soldier key={i} x={at.x} ground={at.ground} f={f} />
          ))}
        </g>
      )}
      {armour !== null && (
        <g transform={infantry > 0 ? 'translate(0 3.2)' : ''}>
          {spread(armour).map((at, i) => (
            <Tank key={i} x={at.x} ground={at.ground} f={f} />
          ))}
        </g>
      )}
    </g>
  );
}
