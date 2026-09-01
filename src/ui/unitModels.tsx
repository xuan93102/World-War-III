import { shade } from './colors';
import {
  INFANTRY_STEPS,
  VEHICLE_STEPS,
  VILLAGER_STEPS,
  tierFor,
  type Tier,
} from './unitTiers';

/**
 * What a force looks like standing on the ground (docs/game-design.md 6.1).
 *
 * A number in a circle says how many; it does not say *what*. These say what:
 * armour at the front, infantry behind it, and villagers behind them, each
 * counted on its own so a column that takes delivery of more tanks grows more
 * tanks without its infantry changing. Three sizes each — a section, a
 * platoon, a battalion — because a model per soldier would be unreadable long
 * before it was accurate, and one model for any number says nothing at all.
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

/**
 * One villager: shorter than a soldier, carrying a load, and — the part that
 * actually does the telling apart at this size — no rifle.
 */
function Villager({ x, ground, f }: { x: number; ground: number; f: Faces }) {
  return (
    <g>
      {box(x, ground, 1.25, 2.5, f)}
      <circle cx={x} cy={ground - 3.45} r={1} fill={f.top} stroke={OUTLINE} strokeWidth={0.28} />
      {box(x + 1.9, ground, 0.85, 1.1, f, 0.45)}
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
  civilians: number;
  color: string;
  /** Height of one model, in world units. */
  scale: number;
  /**
   * Turns the force about, so its armour leads away from the viewer instead of
   * towards them. Used by the side of a battle that is facing up the screen,
   * so that both sides' armour meets in the middle where the shooting is.
   */
  reversed?: boolean;
}

/** How far apart the ranks stand. */
const RANK_GAP = 3.5;

/**
 * A force, planted at the origin. Armour stands at the front, infantry behind
 * it, villagers behind them — front meaning nearer the viewer, which on a
 * tilted map is further down the screen. Each rank is sized from its own count
 * and nothing else, so none of them moves when another changes.
 */
export function TroopModels({
  infantry,
  vehicles,
  civilians,
  color,
  scale,
  reversed = false,
}: TroopModelsProps) {
  const f = faces(color);
  // Back to front, which is also the order they are drawn in, so the ones in
  // front overlap the ones behind rather than the other way round. Reversing
  // the array turns the whole force about and keeps that true, because the
  // last one drawn is still the lowest on the screen.
  const ordered = [
    { n: civilians, steps: VILLAGER_STEPS, Model: Villager },
    { n: infantry, steps: INFANTRY_STEPS, Model: Soldier },
    { n: vehicles, steps: VEHICLE_STEPS, Model: Tank },
  ];
  const ranks = (reversed ? [...ordered].reverse() : ordered).filter((rank) => rank.n > 0);

  return (
    <g transform={`scale(${scale / 6})`} stroke={OUTLINE} strokeWidth={0.28} strokeLinejoin="round">
      {ranks.map(({ n, steps, Model }, rank) => (
        <g
          key={rank}
          transform={`translate(0 ${(rank - (ranks.length - 1) / 2) * RANK_GAP})`}
        >
          {spread(tierFor(n, steps)).map((at, i) => (
            <Model key={i} x={at.x} ground={at.ground} f={f} />
          ))}
        </g>
      ))}
    </g>
  );
}

// ---- a fight, on the ground it is being fought over (docs 6.2) -------------

/** How far each side stands from the middle, in model units. */
const LINE_GAP = 7;

interface Force {
  infantry: number;
  vehicles: number;
  civilians: number;
}

interface BattleModelsProps {
  attacker: Force;
  defender: Force;
  attackerColor: string;
  defenderColor: string;
  scale: number;
  /**
   * The number of rounds fought so far. Nothing is drawn from it — it is the
   * React key for the volley, so a new one mounts each round and its animation
   * plays from the start. The engine decides when a shot is fired; the
   * interface only has to notice.
   */
  round: number;
}

/** Where the tracers cross, drawn once per round. */
function Volley() {
  const shots = [-3.4, -1.1, 1.4, 3.6];
  return (
    <g className="volley">
      {shots.map((x, i) => (
        <line
          key={i}
          className="volley-tracer"
          x1={x}
          y1={-LINE_GAP + 2.4}
          x2={x * -0.6}
          y2={LINE_GAP - 2.4}
          stroke="#ffd54a"
          strokeWidth={0.42}
          strokeLinecap="round"
          style={{ animationDelay: `${i * 55}ms` }}
        />
      ))}
      {[-LINE_GAP + 2.2, LINE_GAP - 2.2].map((y, i) => (
        <circle
          key={`flash-${i}`}
          className="volley-flash"
          cx={i === 0 ? -1.6 : 1.6}
          cy={y}
          r={1.5}
          fill="#fff2b8"
          style={{ animationDelay: `${i * 40}ms` }}
        />
      ))}
      {/* A ring going out from where the two lines meet. */}
      <circle
        className="volley-shock"
        cx={0}
        cy={0}
        r={2.4}
        fill="none"
        stroke="#ffd54a"
        strokeWidth={0.35}
      />
    </g>
  );
}

/**
 * Two forces fighting over a region.
 *
 * They face each other across the ground rather than being one marker with a
 * sword on it, and they fire on the engine's clock — a volley when a round
 * lands, nothing in between. So what you see is what is happening: which side
 * has armour, who is being ground down, and whether the shooting has stopped.
 */
export function BattleModels({
  attacker,
  defender,
  attackerColor,
  defenderColor,
  scale,
  round,
}: BattleModelsProps) {
  return (
    <g transform={`scale(${scale / 6})`} stroke={OUTLINE} strokeWidth={0.28} strokeLinejoin="round">
      {/* Findable at any zoom, which a pair of ten-pixel models is not. */}
      <circle className="battle-halo" cx={0} cy={0} r={LINE_GAP + 1.5} fill="#d9342b" />

      {/* The defender holds the far side, the attacker came from below, and
          each is turned so its armour is on the inside — which means the one
          up the screen keeps its normal order and the one below is reversed,
          because "front" for a lone force means nearest the viewer. */}
      <g className="battle-line" transform={`translate(0 ${-LINE_GAP})`}>
        <TroopModels {...defender} color={defenderColor} scale={6} />
      </g>
      <g className="battle-line battle-line-near" transform={`translate(0 ${LINE_GAP})`}>
        <TroopModels {...attacker} color={attackerColor} scale={6} reversed />
      </g>

      <g key={round}>
        <Volley />
      </g>
    </g>
  );
}
