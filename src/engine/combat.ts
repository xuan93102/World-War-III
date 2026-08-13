import { UNITS, UNIT_ORDER, stackAtk, totalUnits, type UnitCounts } from './units';

/**
 * Combat resolution (docs/game-design.md 6.2).
 *
 * A battle is a multi-round attrition fight, not a single calculation: both
 * sides trade damage simultaneously every COMBAT_ROUND_SECONDS until one is
 * wiped out. Keeping it as running state is what lets reinforcements join a
 * fight already in progress and lets an attacker break off — neither of which
 * means anything if a battle resolves the instant two armies touch.
 */

/** Seconds between rounds. */
export const COMBAT_ROUND_SECONDS = 5;

/**
 * What's left holding a region after both sides wipe each other out — the
 * "無主亂軍" of 6.2. Deliberately small: it exists so mutual annihilation
 * leaves the ground genuinely unclaimed rather than handing it to whoever
 * happened to be defending. v1 number, wants playtest.
 */
export const MUTINY_MILITIA = 3;

export interface DamageResult {
  units: UnitCounts;
  /**
   * Damage that wasn't enough to finish off the next unit, carried into the
   * following round. Without it a militia (ATK 1) could never kill another
   * militia (HP 10), since each round's damage would round away to nothing.
   */
  carry: number;
}

/**
 * Spends `damage` on a stack, killing whole units cheapest-first.
 *
 * Weakest-first is the confirmed rule (6.2): militia soak first and the elite
 * core survives. That's what makes climbing the upgrade tree worth the gold,
 * and it turns "bring some militia as a shield" into a real tactic instead of
 * a strictly worse choice.
 */
export function applyDamage(units: UnitCounts, damage: number, carry = 0): DamageResult {
  const out: UnitCounts = { ...units };
  let left = damage + carry;

  for (const type of UNIT_ORDER) {
    const count = out[type] ?? 0;
    if (count <= 0) continue;
    const hp = UNITS[type].hp;
    const wholeStack = count * hp;
    if (left >= wholeStack) {
      left -= wholeStack;
      delete out[type];
      continue;
    }
    const killed = Math.floor(left / hp);
    if (killed > 0) out[type] = count - killed;
    left -= killed * hp;
    // Everything past here is tougher than what we couldn't finish off, so
    // the rest of the damage waits for next round.
    return { units: out, carry: left };
  }

  // Stack wiped out; anything left over has nothing to hit.
  return { units: out, carry: 0 };
}

export interface RoundOutcome {
  attacker: DamageResult;
  defender: DamageResult;
  attackerWiped: boolean;
  defenderWiped: boolean;
}

/**
 * One exchange. Both sides' attacks are measured *before* either takes
 * casualties, so the trade is genuinely simultaneous — a side that dies this
 * round still lands its blow, which is what allows mutual annihilation.
 */
export function resolveRound(
  attackerUnits: UnitCounts,
  attackerCarry: number,
  defenderUnits: UnitCounts,
  defenderCarry: number,
): RoundOutcome {
  const incomingToDefender = stackAtk(attackerUnits);
  const incomingToAttacker = stackAtk(defenderUnits);

  const attacker = applyDamage(attackerUnits, incomingToAttacker, attackerCarry);
  const defender = applyDamage(defenderUnits, incomingToDefender, defenderCarry);

  return {
    attacker,
    defender,
    attackerWiped: totalUnits(attacker.units) === 0,
    defenderWiped: totalUnits(defender.units) === 0,
  };
}
