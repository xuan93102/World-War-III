import { useEffect, useMemo, useRef, useState } from 'react';
import { GameEngine, type PlayerSetup } from '../../engine/GameEngine';
import { TICK_SECONDS, fixedSteps } from '../../engine/clock';
import { applyOrder, type Order } from '../../engine/orders';
import { aiSeats, localPlayerId, type Seat } from '../../match/seats';
import { snapshotFor } from '../../engine/snapshot';
import { parseOrder } from '../../engine/orders';
import type { Connection } from '../../match/connection';
import type { GameState } from '../../engine/types';
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

/**
 * How often the host posts the guest a fresh view of the world. Every frame:
 * the whole state is 4-16 KB, so there's nothing yet to be clever about, and
 * the guest smooths the gaps by stepping its own copy in between.
 */
const SNAPSHOT_INTERVAL_MS = FRAME_INTERVAL_MS;

/** Fast-forward, for watching a match nobody is steering. */
const SPEEDS = [1, 2, 4, 8];

interface GameScreenProps {
  setups: PlayerSetup[];
  /** Who is playing each side (docs 15.4) — a human here, a machine, or someone else's machine. */
  seats: Seat[];
  /** Pause is single-player only; a networked match can't unilaterally stop. */
  canPause: boolean;
  /** Present in a networked match: which end we are, and the wire (docs 15.4). */
  net?: { role: 'host' | 'guest'; connection: Connection; opponentId: string };
  onQuit: () => void;
  onPlayAgain: () => void;
}

export function GameScreen({
  setups,
  seats,
  canPause,
  net,
  onQuit,
  onPlayAgain,
}: GameScreenProps) {
  const { t } = useSettings();
  // One engine per mounted match. Keyed remounting from the parent is what
  // starts a fresh game, so this deliberately ignores later `setups` changes.
  const engine = useMemo(() => new GameEngine(setups), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Whose eyes we're looking through, and whether anyone here is playing at
  // all — watching two machines is simply a match with no human seat.
  const humanPlayerId = localPlayerId(seats);
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
  // The other end went away (docs 15.5). The clock stops rather than running
  // on against nobody, because whatever happens next is not a match.
  const [peerGone, setPeerGone] = useState(false);
  const lastTimeRef = useRef<number>(performance.now());
  // Real time that has passed but not yet been spent on whole steps.
  const bankedRef = useRef(0);
  const lastSentRef = useRef(0);
  // One controller per AI seat, built once per match (docs 13). They take the
  // same orders a human does — the engine has no idea which is which.
  const seatsRef = useRef<AiController[]>([]);
  if (seatsRef.current.length === 0) {
    seatsRef.current = aiSeats(seats).map((seat) => new AiController(seat.playerId, seat.difficulty));
  }

  /**
   * The one place a local order reaches the engine (docs 15.2). Everything
   * the player can do goes through here as data, which is what lets the same
   * action later be handed to a host instead of to our own engine.
   */
  const issue = (order: Order) => {
    if (humanPlayerId === null) return;
    // The guest does it locally *and* asks for it to be done for real. The
    // local copy is a prediction: it makes the button feel immediate, and
    // the next snapshot is the truth if the two disagree (docs 15.4).
    if (net?.role === 'guest') net.connection.send({ t: 'order', order });
    applyOrder(engine, humanPlayerId, order);
    forceRender((n) => n + 1);
  };

  // What the other end has to say. Orders if we're the host, the world if
  // we're the guest.
  const incoming = useRef<GameState | null>(null);
  useEffect(() => {
    if (!net) return;
    net.connection.onState = (state) => setPeerGone(state.at === 'gone');
    net.connection.onMessage = (data) => {
      if (typeof data !== 'object' || data === null) return;
      const message = data as { t?: unknown; order?: unknown; state?: unknown };
      if (net.role === 'host' && message.t === 'order') {
        // Parsed before it goes anywhere near the engine, and carried out as
        // the player whose socket it arrived on — never as whoever it claims.
        const order = parseOrder(message.order);
        if (order) applyOrder(engine, net.opponentId, order);
        return;
      }
      if (net.role === 'guest' && message.t === 'snapshot') {
        incoming.current = message.state as GameState;
      }
    };
    return () => {
      net.connection.onMessage = () => {};
      net.connection.onState = () => {};
    };
  }, [net, engine]);

  const winner = engine.getWinner();
  const isOver = winner !== null;
  // Freeze the clock while paused, once the match is decided, or while the
  // quit confirmation is up — otherwise resources keep ticking behind a modal.
  const clockStopped = paused || isOver || confirmQuit || peerGone;

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
      // A snapshot that has arrived replaces everything: it is the truth,
      // and whatever the guest predicted since the last one was a guess.
      if (incoming.current) {
        engine.state = incoming.current;
        incoming.current = null;
      }
      for (let step = 0; step < steps; step++) {
        engine.tick(TICK_SECONDS);
        // Only the machine that owns a controller runs it. A guest ticking
        // its own copy is smoothing the gaps between snapshots, not playing.
        if (net?.role !== 'guest') {
          for (const seat of seatsRef.current) seat.update(engine, TICK_SECONDS);
        }
      }
      if (net?.role === 'host' && now - lastSentRef.current >= SNAPSHOT_INTERVAL_MS) {
        lastSentRef.current = now;
        net.connection.send({ t: 'snapshot', state: snapshotFor(engine, net.opponentId) });
      }
      if (steps > 0) forceRender((n) => n + 1);
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [engine, clockStopped, spectating, speed, net]);

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

      {peerGone && !isOver && (
        <Modal
          title={t('pvp.opponentLeft')}
          actions={
            <button className="btn btn-primary" onClick={onQuit}>
              {t('result.toMenu')}
            </button>
          }
        >
          <p className="modal-body">{t('pvp.opponentLeftBody')}</p>
        </Modal>
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
