import { useEffect, useMemo, useRef, useState } from 'react';
import { GameEngine, type PlayerSetup } from '../../engine/GameEngine';
import { TICK_SECONDS, fixedSteps } from '../../engine/clock';
import { applyOrder, type Order } from '../../engine/orders';
import { useSettings } from '../../settings/useSettings';
import { AiController } from '../../ai/AiController';
import { HUD } from '../HUD';
import { MapView } from '../MapView';
import { TechPanel } from '../TechPanel';
import { MatchClock } from '../MatchClock';
import { Modal } from '../Modal';
import { RegionPanel } from '../RegionPanel';
import { SpectatePanel } from '../SpectatePanel';
import { VillagerBar } from '../VillagerBar';

/**
 * How often the loop wakes to draw. The simulation does not advance by this
 * much — it advances in whole TICK_SECONDS steps (see engine/clock.ts), and
 * this is only how often we look.
 */
const FRAME_INTERVAL_MS = 200;

/** Fast-forward, for watching a match nobody is steering. */
const SPEEDS = [1, 2, 4, 8];

interface GameScreenProps {
  setups: PlayerSetup[];
  /**
   * The seat the local player controls, or null when nobody is playing and
   * the match is only being watched.
   */
  humanPlayerId: string | null;
  /** Pause is single-player only; a networked match can't unilaterally stop. */
  canPause: boolean;
  onQuit: () => void;
  onPlayAgain: () => void;
}

export function GameScreen({
  setups,
  humanPlayerId,
  canPause,
  onQuit,
  onPlayAgain,
}: GameScreenProps) {
  const { t } = useSettings();
  // One engine per mounted match. Keyed remounting from the parent is what
  // starts a fresh game, so this deliberately ignores later `setups` changes.
  const engine = useMemo(() => new GameEngine(setups), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Nobody in a seat: no fog, no orders, and the clock can be wound forward.
  const spectating = humanPlayerId === null;

  const [, forceRender] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  // While picking a march destination, map clicks choose the target instead of
  // changing which region the panel is showing — otherwise selecting the
  // destination would navigate away from the panel issuing the order.
  const [showTech, setShowTech] = useState(false);
  const [paused, setPaused] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const lastTimeRef = useRef<number>(performance.now());
  // Real time that has passed but not yet been spent on whole steps.
  const bankedRef = useRef(0);
  // One controller per AI seat, built once per match (docs 13). They take the
  // same orders a human does — the engine has no idea which is which.
  const seatsRef = useRef<AiController[]>([]);
  if (seatsRef.current.length === 0) {
    seatsRef.current = Object.values(engine.state.players)
      .filter((p) => p.aiDifficulty !== undefined)
      .map((p) => new AiController(p.id, p.aiDifficulty!));
  }

  /**
   * The one place a local order reaches the engine (docs 15.2). Everything
   * the player can do goes through here as data, which is what lets the same
   * action later be handed to a host instead of to our own engine.
   */
  const issue = (order: Order) => {
    if (humanPlayerId === null) return;
    applyOrder(engine, humanPlayerId, order);
    forceRender((n) => n + 1);
  };

  const winner = engine.getWinner();
  const isOver = winner !== null;
  // Freeze the clock while paused, once the match is decided, or while the
  // quit confirmation is up — otherwise resources keep ticking behind a modal.
  const clockStopped = paused || isOver || confirmQuit;

  useEffect(() => {
    if (clockStopped) return;
    // Reset the timestamp on resume so the paused span isn't applied as one
    // huge delta the moment the clock restarts.
    lastTimeRef.current = performance.now();
    bankedRef.current = 0;
    const intervalId = setInterval(() => {
      const now = performance.now();
      const deltaSeconds = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;
      // Watching at speed runs more steps per second, never longer ones — a
      // step is a step whoever is looking and however fast.
      bankedRef.current += deltaSeconds * (spectating ? speed : 1);
      const { steps, left } = fixedSteps(bankedRef.current);
      bankedRef.current = left;
      for (let step = 0; step < steps; step++) {
        engine.tick(TICK_SECONDS);
        for (const seat of seatsRef.current) seat.update(engine, TICK_SECONDS);
      }
      if (steps > 0) forceRender((n) => n + 1);
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [engine, clockStopped, spectating, speed]);

  const players = Object.values(engine.state.players);
  const intel: Record<string, ReturnType<GameEngine['intelOn']>> = {};
  const economies: Record<string, ReturnType<GameEngine['economy']>> = {};
  const populations: Record<string, number> = {};
  for (const p of players) {
    intel[p.id] = engine.intelOn(spectating ? p.id : humanPlayerId, p.id);
    economies[p.id] = engine.economy(p.id);
    populations[p.id] = engine.population(p.id);
  }

  const humanWon = winner?.id === humanPlayerId;
  const wonder = engine.wonderCountdown();
  // Watching sees the whole board — there is no seat to keep secrets from.
  const visible = spectating
    ? new Set(engine.map.regions.map((r) => r.id))
    : engine.visibleTo(humanPlayerId!);

  return (
    <div className="app">
      <div className="game-topbar">
        <HUD
          players={players}
          viewerId={humanPlayerId}
          intel={intel}
          economies={economies}
          populations={populations}
        />
        <MatchClock
          elapsedSeconds={engine.state.elapsedSeconds}
          secondsUntilPayout={engine.state.secondsUntilPayout}
          nextPayout={humanPlayerId ? (economies[humanPlayerId]?.moneyPerMin ?? 0) : 0}
        />
        {humanPlayerId && (
          <VillagerBar
            engine={engine}
            playerId={humanPlayerId}
            onBuy={(count) => issue({ type: 'buyVillagers', count })}
          />
        )}
        <div className="topbar-actions">
          {humanPlayerId && (
            <button className="btn btn-sm" onClick={() => setShowTech(true)} disabled={isOver}>
              {t('tech.section')}
              {engine.state.players[humanPlayerId].research.length > 0 &&
                `・${engine.state.players[humanPlayerId].research.length}`}
            </button>
          )}
          {/* Wind the clock forward — a whole match takes a while to watch. */}
          {spectating && (
            <span className="speed-control">
              {SPEEDS.map((x) => (
                <button
                  key={x}
                  className={`btn btn-sm${speed === x ? ' is-selected' : ''}`}
                  onClick={() => setSpeed(x)}
                  aria-pressed={speed === x}
                  disabled={isOver}
                >
                  ×{x}
                </button>
              ))}
            </span>
          )}
          {wonder && (
            <span className="wonder-countdown" style={{ color: engine.state.players[wonder.playerId]?.color }}>
              {t('game.wonderCountdown')} {Math.ceil(wonder.secondsLeft)}s
            </span>
          )}
          {canPause && (
            <button
              className="btn btn-sm"
              onClick={() => setPaused((p) => !p)}
              disabled={isOver}
              aria-pressed={paused}
            >
              {paused ? t('game.resume') : t('game.pause')}
            </button>
          )}
          <button className="btn btn-sm btn-ghost" onClick={() => setConfirmQuit(true)}>
            {t('game.quit')}
          </button>
        </div>
      </div>

      <div className="app-body">
        <div className="map-container">
          <MapView
            gameState={engine.state}
            players={players}
            selectedRegionId={selectedRegionId}
            map={engine.map}
            marchRoute={null}
            routeFrom={null}
            visible={visible}
            viewerId={humanPlayerId ?? ''}
            passesUnlocked={
              spectating
                ? players.some((p) => engine.hasMountainRoad(p.id))
                : engine.hasMountainRoad(humanPlayerId!)
            }
            onSelectRegion={(id) => setSelectedRegionId(id)}
          />
          {paused && !isOver && (
            <div className="pause-overlay">
              <span className="pause-badge">{t('game.paused')}</span>
            </div>
          )}
        </div>
        {humanPlayerId === null ? (
          <SpectatePanel engine={engine} players={players} selectedRegionId={selectedRegionId} />
        ) : (
        <RegionPanel
          engine={engine}
          players={players}
          humanPlayerId={humanPlayerId}
          selectedRegionId={selectedRegionId}
          onBuild={(regionId, building) => issue({ type: 'build', regionId, building })}
          onTrain={(regionId, unit, count) => issue({ type: 'train', regionId, unit, count })}
          onUpgrade={(regionId, unit, count) => issue({ type: 'upgrade', regionId, unit, count })}
          onRetreat={(regionId) => issue({ type: 'retreat', regionId })}
          onOrderHere={(regionId, order) => issue({ type: 'orderHere', regionId, order })}
          onStaff={(regionId, count) => issue({ type: 'staff', regionId, count })}
          onUnstaff={(regionId, count) => issue({ type: 'unstaff', regionId, count })}
          onStandDown={(regionId) => issue({ type: 'standDown', regionId })}
          onQueueVehicles={(regionId, unit, count) =>
            issue({ type: 'queueVehicles', regionId, unit, count })
          }
          onCancelProduction={(index) => issue({ type: 'cancelProduction', index })}
          onBombard={(from, to) => issue({ type: 'bombard', from, to })}
          onCeaseFire={(regionId) => issue({ type: 'ceaseFire', regionId })}
          onDispatchCart={(from, to, porters) => issue({ type: 'dispatchCart', from, to, porters })}
          onMarch={(from, to, units, onArrival) =>
            issue({ type: 'march', from, to, units, onArrival })
          }
          onCancelBuild={(regionId) => issue({ type: 'cancelBuild', regionId })}
          onDemolish={(regionId) => issue({ type: 'demolish', regionId })}
        />
        )}
      </div>

      {showTech && !isOver && humanPlayerId && (
        <TechPanel
          engine={engine}
          playerId={humanPlayerId}
          onClose={() => setShowTech(false)}
          onOrder={issue}
        />
      )}

      {confirmQuit && !isOver && (
        <Modal
          title={t('confirm.quitTitle')}
          onDismiss={() => setConfirmQuit(false)}
          actions={
            <>
              <button className="btn" onClick={() => setConfirmQuit(false)}>
                {t('confirm.cancel')}
              </button>
              <button className="btn btn-danger" onClick={onQuit}>
                {t('confirm.confirm')}
              </button>
            </>
          }
        >
          <p className="modal-body">{t('confirm.quitBody')}</p>
        </Modal>
      )}

      {isOver && (
        <Modal
          title={
            spectating
              ? t('spectate.result').replace('{name}', winner?.name ?? '')
              : humanWon
                ? t('result.victory')
                : t('result.defeat')
          }
          actions={
            <>
              <button className="btn" onClick={onQuit}>
                {t('result.toMenu')}
              </button>
              <button className="btn btn-primary" onClick={onPlayAgain}>
                {t('result.playAgain')}
              </button>
            </>
          }
        >
          <p
            className={`result-banner ${spectating ? '' : humanWon ? 'is-victory' : 'is-defeat'}`}
            style={spectating ? { color: winner?.color } : undefined}
          >
            {spectating
              ? t('spectate.resultDesc').replace(
                  '{n}',
                  String(Math.round(engine.state.elapsedSeconds / 60)),
                )
              : humanWon
                ? t('result.victoryDesc')
                : t('result.defeatDesc')}
          </p>
        </Modal>
      )}
    </div>
  );
}
