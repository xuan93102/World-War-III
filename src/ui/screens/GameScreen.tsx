import { useEffect, useMemo, useRef, useState } from 'react';
import { GameEngine, type PlayerSetup } from '../../engine/GameEngine';
import { useSettings } from '../../settings/useSettings';
import { HUD } from '../HUD';
import { MapView } from '../MapView';
import { TechPanel } from '../TechPanel';
import { MatchClock } from '../MatchClock';
import { Modal } from '../Modal';
import { RegionPanel } from '../RegionPanel';
import { VillagerBar } from '../VillagerBar';

const TICK_INTERVAL_MS = 200;

interface GameScreenProps {
  setups: PlayerSetup[];
  /** The seat the local player controls — decides victory vs defeat wording. */
  humanPlayerId: string;
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

  const [, forceRender] = useState(0);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  // While picking a march destination, map clicks choose the target instead of
  // changing which region the panel is showing — otherwise selecting the
  // destination would navigate away from the panel issuing the order.
  const [marchTarget, setMarchTarget] = useState<string | null>(null);
  const [pickingMarch, setPickingMarch] = useState(false);
  const [showTech, setShowTech] = useState(false);
  const [paused, setPaused] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const lastTimeRef = useRef<number>(performance.now());

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
      engine.tick(deltaSeconds);
      forceRender((n) => n + 1);
    }, TICK_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [engine, clockStopped]);

  const players = Object.values(engine.state.players);
  const ownedCounts: Record<string, number> = {};
  const economies: Record<string, ReturnType<GameEngine['economy']>> = {};
  const populations: Record<string, number> = {};
  for (const p of players) {
    ownedCounts[p.id] = engine.ownedRegionCount(p.id);
    economies[p.id] = engine.economy(p.id);
    populations[p.id] = engine.population(p.id);
  }

  const humanWon = winner?.id === humanPlayerId;
  const wonder = engine.wonderCountdown();

  return (
    <div className="app">
      <div className="game-topbar">
        <HUD players={players} ownedCounts={ownedCounts} economies={economies} populations={populations} />
        <MatchClock
          elapsedSeconds={engine.state.elapsedSeconds}
          secondsUntilPayout={engine.state.secondsUntilPayout}
          nextPayout={economies[humanPlayerId]?.moneyPerMin ?? 0}
        />
        <VillagerBar
          engine={engine}
          playerId={humanPlayerId}
          onBuy={(count) => {
            engine.buyVillagers(humanPlayerId, count);
            forceRender((n) => n + 1);
          }}
        />
        <div className="topbar-actions">
          <button className="btn btn-sm" onClick={() => setShowTech(true)} disabled={isOver}>
            {t('tech.section')}
            {engine.state.players[humanPlayerId].research.length > 0 &&
              `・${engine.state.players[humanPlayerId].research.length}`}
          </button>
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
            marchRoute={
              pickingMarch && selectedRegionId && marchTarget
                ? engine.marchRoute(selectedRegionId, marchTarget, humanPlayerId)
                : null
            }
            routeFrom={pickingMarch ? selectedRegionId : null}
            onSelectRegion={(id) => {
              if (pickingMarch) setMarchTarget(id);
              else setSelectedRegionId(id);
            }}
          />
          {paused && !isOver && (
            <div className="pause-overlay">
              <span className="pause-badge">{t('game.paused')}</span>
            </div>
          )}
        </div>
        <RegionPanel
          engine={engine}
          players={players}
          humanPlayerId={humanPlayerId}
          selectedRegionId={selectedRegionId}
          marchTarget={marchTarget}
          pickingMarch={pickingMarch}
          onPickMarch={(picking) => {
            setPickingMarch(picking);
            if (!picking) setMarchTarget(null);
          }}
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
          onMarch={(from, to, units) => {
            engine.startMarch(from, to, humanPlayerId, units);
            setPickingMarch(false);
            setMarchTarget(null);
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
      </div>

      {showTech && !isOver && (
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
          title={humanWon ? t('result.victory') : t('result.defeat')}
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
          <p className={`result-banner ${humanWon ? 'is-victory' : 'is-defeat'}`}>
            {humanWon ? t('result.victoryDesc') : t('result.defeatDesc')}
          </p>
        </Modal>
      )}
    </div>
  );
}
