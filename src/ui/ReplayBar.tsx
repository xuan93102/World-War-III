import { TICK_SECONDS } from '../engine/clock';
import { useSettings } from '../settings/useSettings';

interface ReplayBarProps {
  step: number;
  steps: number;
  /** True while the match is being rebuilt to reach a new position. */
  seeking: boolean;
  onSeek: (step: number) => void;
  onTakeOver: () => void;
}

function clock(steps: number): string {
  const total = Math.round(steps * TICK_SECONDS);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Moving about inside a match that has already happened (docs 16).
 *
 * Dragging is committed on release rather than followed live, because going
 * backwards means replaying the match from its first step — a few seconds of
 * work for a long game, and not something to do sixty times while a thumb
 * slides across a bar.
 */
export function ReplayBar({ step, steps, seeking, onSeek, onTakeOver }: ReplayBarProps) {
  const { t } = useSettings();
  return (
    <div className="replay-bar">
      <span className="replay-time">{clock(step)}</span>
      <input
        className="replay-scrub"
        type="range"
        min={0}
        max={steps}
        value={step}
        step={10}
        disabled={seeking}
        aria-label={t('replay.scrub')}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
      <span className="replay-time replay-time-total">{clock(steps)}</span>
      <button className="btn btn-sm" onClick={onTakeOver} disabled={seeking}>
        {t('replay.takeOver')}
      </button>
      {seeking && <span className="replay-seeking">{t('replay.rebuilding')}</span>}
    </div>
  );
}
