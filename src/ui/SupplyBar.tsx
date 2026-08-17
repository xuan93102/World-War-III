import { SUPPLY_BROKEN, SUPPLY_STRAINED } from '../engine/supply';
import { useSettings } from '../settings/useSettings';

/**
 * A legion's supply (docs/game-design.md 7). Coloured by which penalty band
 * it's in, so "this army is in trouble" reads without doing the arithmetic.
 */
export function SupplyBar({ supply }: { supply: number }) {
  const { t } = useSettings();
  const band = supply < SUPPLY_BROKEN ? 'broken' : supply < SUPPLY_STRAINED ? 'strained' : 'ok';
  const labelKey = band === 'broken' ? 'supply.broken' : band === 'strained' ? 'supply.strained' : 'supply.ok';

  return (
    <div className="supply-row">
      <span className="supply-head">
        <span className="field-label">{t('supply.label')}</span>
        <span className={`supply-state is-${band}`}>
          {t(labelKey)}・{Math.round(supply * 100)}%
        </span>
      </span>
      <div className="supply-track">
        <div className={`supply-fill is-${band}`} style={{ width: `${Math.max(0, supply) * 100}%` }} />
      </div>
    </div>
  );
}
