import { PAYOUT_INTERVAL_SECONDS } from '../engine/GameEngine';
import { useSettings } from '../settings/useSettings';

interface MatchClockProps {
  elapsedSeconds: number;
  secondsUntilPayout: number;
  /** The instalment that will land at the next payout. */
  nextPayout: number;
}

function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function MatchClock({ elapsedSeconds, secondsUntilPayout, nextPayout }: MatchClockProps) {
  const { t } = useSettings();
  const progress = 1 - secondsUntilPayout / PAYOUT_INTERVAL_SECONDS;

  return (
    <div className="match-clock">
      <span className="match-time" title={t('game.elapsed')}>
        {mmss(elapsedSeconds)}
      </span>
      <span className="payout-line">
        <span className="payout-label">
          {t('game.nextPayout')} {Math.ceil(secondsUntilPayout)}s
        </span>
        <span className="payout-amount">+{Math.floor(nextPayout)}</span>
      </span>
      <span className="payout-track" aria-hidden="true">
        <span className="payout-fill" style={{ width: `${Math.min(100, progress * 100)}%` }} />
      </span>
    </div>
  );
}
