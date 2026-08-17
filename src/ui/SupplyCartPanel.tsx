import { useState } from 'react';
import { CART_FOOD_LOAD } from '../engine/supply';
import { useSettings } from '../settings/useSettings';
import type { GameEngine } from '../engine/GameEngine';

interface SupplyCartPanelProps {
  engine: GameEngine;
  regionId: string;
  playerId: string;
  onDispatch: (from: string, to: string, porters: number) => void;
}

/**
 * Supply carts (docs/game-design.md 7). Only shows up where it can do
 * something: a granary sends carts, a fortress holds what they deliver, and
 * either end reports the ones on the road.
 */
export function SupplyCartPanel({ engine, regionId, playerId, onDispatch }: SupplyCartPanelProps) {
  const { t } = useSettings();
  const [porters, setPorters] = useState(1);
  const [target, setTarget] = useState<string | null>(null);

  const region = engine.state.regions[regionId];
  const isGranary = region.owner === playerId && region.building?.type === 'granary';
  const stock =
    region.owner === playerId && region.building?.type === 'fortress'
      ? (region.building.stock ?? 0)
      : 0;
  const carts = engine.cartsInvolving(regionId).filter((c) => c.playerId === playerId);

  if (!isGranary && stock <= 0 && carts.length === 0) return null;

  const villagers = engine.state.players[playerId]?.villagers ?? 0;
  const take = Math.min(porters, Math.max(1, villagers));
  const targets = isGranary ? engine.cartTargets(regionId, playerId) : [];
  const rejection = target ? engine.cartRejection(regionId, target, playerId, take) : null;
  const route = target ? engine.marchRoute(regionId, target, playerId) : null;
  const eta = route ? engine.cartRouteSeconds(regionId, route, take) : 0;

  return (
    <section className="cart-section">
      <div className="field-label">{t('cart.section')}</div>

      {stock > 0 && (
        <p className="cart-stock">
          {t('cart.stock').replace('{n}', String(Math.floor(stock)))}
        </p>
      )}

      {carts.map((cart) => (
        <div key={cart.id} className="cart-transit">
          <span className="cart-transit-label">
            {t(cart.returning ? 'cart.returning' : 'cart.outbound')}
          </span>
          <span className="cart-transit-body">
            {engine.map.region(cart.to).name}・{t('cart.porters')} ×{cart.porters}
          </span>
          <span className="cart-transit-eta">
            {t('march.eta').replace('{n}', String(Math.ceil(cart.remainingSeconds)))}
          </span>
        </div>
      ))}

      {isGranary && (
        <>
          <p className="cart-fleet">
            {t('cart.fleet')
              .replace('{free}', String(engine.cartsAvailable(playerId)))
              .replace('{cap}', String(engine.supplyCartCap(playerId)))}
          </p>

          {targets.length === 0 ? (
            <p className="hint-text">{t('cart.noTargets')}</p>
          ) : (
            <>
              <div className="cart-targets">
                {targets.map((id) => (
                  <button
                    key={id}
                    className={`cart-target${target === id ? ' is-selected' : ''}`}
                    onClick={() => setTarget(id)}
                  >
                    <span className="cart-target-name">{engine.map.region(id).name}</span>
                    <span className="cart-target-time">
                      {engine.cartRouteSeconds(
                        regionId,
                        engine.marchRoute(regionId, id, playerId) ?? [],
                        take,
                      )}
                      s
                    </span>
                  </button>
                ))}
              </div>

              {/* Porters are villagers: more of them is a faster cart and a
                  smaller payroll until it gets home. */}
              <div className="cart-porters">
                <span className="cart-porters-label">
                  {t('cart.porters')}
                  <em className="cart-porters-have">／{villagers}</em>
                </span>
                <span className="march-stepper">
                  <button
                    className="btn btn-sm"
                    disabled={take <= 1}
                    onClick={() => setPorters(take - 1)}
                  >
                    −
                  </button>
                  <span className="march-count">{take}</span>
                  <button
                    className="btn btn-sm"
                    disabled={take >= villagers}
                    onClick={() => setPorters(take + 1)}
                  >
                    +
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={take >= villagers}
                    onClick={() => setPorters(villagers)}
                  >
                    {t('march.all')}
                  </button>
                </span>
              </div>

              <button
                className="btn btn-primary btn-sm"
                disabled={target === null || rejection !== null}
                onClick={() => {
                  if (!target) return;
                  onDispatch(regionId, target, take);
                  setTarget(null);
                }}
              >
                {target && rejection === null
                  ? `${t('cart.depart')}・${engine.map.region(target).name}（${eta}s）`
                  : t('cart.pickTarget')}
              </button>

              {rejection === 'noCart' && <p className="hint-text">{t('cart.reject.noCart')}</p>}
              {rejection === 'noFood' && (
                <p className="hint-text">
                  {t('cart.reject.noFood').replace('{n}', String(CART_FOOD_LOAD))}
                </p>
              )}
              {rejection === 'noPorters' && (
                <p className="hint-text">{t('cart.reject.noPorters')}</p>
              )}
            </>
          )}
          <p className="hint-text">{t('cart.hint').replace('{n}', String(CART_FOOD_LOAD))}</p>
        </>
      )}
    </section>
  );
}
