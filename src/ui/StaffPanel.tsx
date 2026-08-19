import { useState } from 'react';
import { BUILDINGS, MAX_STAFF, STAFFABLE, STAFF_BONUS } from '../engine/buildings';
import { useSettings } from '../settings/useSettings';
import type { GameEngine } from '../engine/GameEngine';

interface StaffPanelProps {
  engine: GameEngine;
  regionId: string;
  playerId: string;
  onStaff: (regionId: string, count: number) => void;
  onUnstaff: (regionId: string, count: number) => void;
}

/**
 * Putting villagers to work in a building (docs 4.2).
 *
 * A building is worth exactly what its crew makes it worth — empty, it does
 * nothing at all — so this is not a detail panel, it's where the economy
 * actually happens. Villagers have to be standing on the region to walk in,
 * which is why it shows what's outside the door as well as what's in.
 */
export function StaffPanel({ engine, regionId, playerId, onStaff, onUnstaff }: StaffPanelProps) {
  const { t } = useSettings();
  const [count, setCount] = useState(1);

  const region = engine.state.regions[regionId];
  const building = region.building;
  if (!building || !STAFFABLE.includes(building.type)) return null;
  if (region.owner !== playerId) return null;

  const staff = building.staff ?? 0;
  const outside = engine.ownGarrisonAt(regionId, playerId).villager ?? 0;
  const room = MAX_STAFF - staff;
  const goingIn = Math.min(count, room, outside);
  const comingOut = Math.min(count, staff);

  return (
    <section className="staff-section">
      <div className="field-label">{t('staff.section')}</div>

      <div className="staff-head">
        <span className="staff-crew">
          {t('staff.inside')} {staff}/{MAX_STAFF}
        </span>
        <span className="staff-bonus">
          {t(BUILDINGS[building.type].nameKey)} +{Math.round(staff * STAFF_BONUS * 100)}%
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${(staff / MAX_STAFF) * 100}%` }} />
      </div>

      <div className="staff-actions">
        <span className="march-stepper">
          <button className="btn btn-sm" disabled={count <= 1} onClick={() => setCount(count - 1)}>
            −
          </button>
          <span className="march-count">{count}</span>
          <button className="btn btn-sm" onClick={() => setCount(count + 1)}>
            +
          </button>
          <button className="btn btn-sm" onClick={() => setCount(MAX_STAFF)}>
            {t('unit.max')}
          </button>
        </span>
        <button
          className="btn btn-sm btn-primary"
          disabled={goingIn < 1}
          onClick={() => onStaff(regionId, goingIn)}
        >
          {t('staff.assign')}
        </button>
        <button
          className="btn btn-sm"
          disabled={comingOut < 1}
          onClick={() => onUnstaff(regionId, comingOut)}
        >
          {t('staff.withdraw')}
        </button>
      </div>

      <p className="hint-text">
        {outside > 0
          ? t('staff.waiting').replace('{n}', String(outside))
          : staff < MAX_STAFF
            ? t('staff.needVillagers')
            : t('staff.full')}
      </p>
    </section>
  );
}
