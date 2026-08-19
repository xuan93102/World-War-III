import { useEffect, useMemo, useRef, useState } from 'react';
import { GameEngine, type PlayerSetup } from '../../engine/GameEngine';
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

const TICK_INTERVAL_MS = 200;

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
  // One controller per AI seat, built once per match (docs 13). They take the
  // same orders a human does — the engine has no idea which is which.
  const seatsRef = useRef<AiController[]>([]);
  if (seatsRef.current.length === 0) {
    seatsRef.current = Object.values(engine.state.players)
      .filter((p) => p.aiDifficulty !== undefined)
      .map((p) => new AiController(p.id, p.aiDifficulty!));
  }

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
    const intervalId = setInterval(() => {
      const now = performance.now();
      const deltaSeconds = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;
      const step = deltaSeconds * (spectating ? speed : 1);
      engine.tick(step);
      for (const seat of seatsRef.current) seat.update(engine, step);
      forceRender((n) => n + 1);
    }, TICK_INTERVAL_MS);
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
            onBuy={(count) => {
              engine.buyVillagers(humanPlayerId, count);
              forceRender((n) => n + 1);
            }}
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
          onClaim={(regionId, owner) => {
            engine.setRegionOwner(regionId, owner);
            forceRender((n) => n + 1);
          }}
          onBuild={(regionId, type) => {
            engine.startConstruction(regionId, type, humanPlayerId);
            forceRender((n) => n + 1);
          }}
          onTrain={(regionId, type, count) => {
            engine.trainUnits(regionId, humanPlayerId, type, count);
            forceRender((n) => n + 1);
          }}
          onUpgrade={(regionId, type, count) => {
            engine.upgradeUnits(regionId, humanPlayerId, type, count);
            forceRender((n) => n + 1);
          }}
          onRetreat={(regionId) => {
            engine.retreat(regionId, humanPlayerId);
            forceRender((n) => n + 1);
          }}
          onOrderHere={(regionId, order) => {
            engine.orderHere(regionId, humanPlayerId, order);
            forceRender((n) => n + 1);
          }}
          onStandDown={(regionId) => {
            engine.standDown(regionId, humanPlayerId);
            forceRender((n) => n + 1);
          }}
          onQueueVehicles={(regionId, type, count) => {
            engine.queueVehicles(regionId, humanPlayerId, type, count);
            forceRender((n) => n + 1);
          }}
          onCancelProduction={(index) => {
            engine.cancelProduction(humanPlayerId, index);
            forceRender((n) => n + 1);
          }}
          onBombard={(from, to) => {
            engine.bombard(from, to, humanPlayerId);
            forceRender((n) => n + 1);
          }}
          onCeaseFire={(regionId) => {
            engine.ceaseFire(regionId, humanPlayerId);
            forceRender((n) => n + 1);
          }}
          onDispatchCart={(from, to, porters) => {
            engine.dispatchCart(from, to, humanPlayerId, porters);
            forceRender((n) => n + 1);
          }}
          onMarch={(from, to, units, onArrival) => {
            engine.startMarch(from, to, humanPlayerId, units, onArrival);
            forceRender((n) => n + 1);
          }}
          onCancelBuild={(regionId) => {
            engine.cancelConstruction(regionId, humanPlayerId);
            forceRender((n) => n + 1);
          }}
          onDemolish={(regionId) => {
            engine.demolish(regionId, humanPlayerId);
            forceRender((n) => n + 1);
          }}
        />
        )}
      </div>

      {showTech && !isOver && humanPlayerId && (
        <TechPanel
          engine={engine}
          playerId={humanPlayerId}
          onClose={() => setShowTech(false)}
          onChanged={() => forceRender((n) => n + 1)}
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
