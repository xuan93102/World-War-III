import { useRef, useState } from 'react';
import { useSettings } from '../../settings/useSettings';
import {
  forgetReplay,
  parseRecording,
  savedReplays,
  type Recording,
} from '../../match/recording';
import { TICK_SECONDS } from '../../engine/clock';
import { getMap, DEFAULT_MAP_ID } from '../../engine/maps';

interface ReplayListProps {
  onWatch: (recording: Recording) => void;
  onBack: () => void;
}

function minutes(steps: number): number {
  return Math.round((steps * TICK_SECONDS) / 60);
}

/**
 * Matches already played (docs/game-design.md 16).
 *
 * Every finished match puts itself here, so there is nothing to remember to
 * do while a game is going on. A recording is a few kilobytes of decisions,
 * which is why the browser can keep several and why one can be handed to
 * somebody else as a file.
 */
export function ReplayList({ onWatch, onBack }: ReplayListProps) {
  const { t } = useSettings();
  const [replays, setReplays] = useState<Recording[]>(() => savedReplays());
  const [rejected, setRejected] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const openFile = async (file: File) => {
    setRejected(false);
    try {
      const recording = parseRecording(JSON.parse(await file.text()));
      if (recording) onWatch(recording);
      else setRejected(true);
    } catch {
      setRejected(true);
    }
  };

  return (
    <div className="screen screen-centered">
      <h2 className="screen-title">{t('replay.title')}</h2>

      {rejected && <p className="notice">{t('replay.badFile')}</p>}

      <div className="panel panel-wide">
        {replays.length === 0 ? (
          <p className="hint-text">{t('replay.none')}</p>
        ) : (
          <div className="card-list">
            {replays.map((recording) => {
              const map = getMap(DEFAULT_MAP_ID);
              const where = recording.setups
                .map((s) => {
                  try {
                    return map.region(s.coreRegionId).name;
                  } catch {
                    return s.name;
                  }
                })
                .join(' vs ');
              return (
                <div key={recording.playedAt} className="replay-row">
                  <button className="card-option" onClick={() => onWatch(recording)}>
                    <span className="card-option-title">
                      {new Date(recording.playedAt).toLocaleString()}
                    </span>
                    <span className="card-option-desc">
                      {where}・
                      {t('replay.length').replace('{n}', String(minutes(recording.steps)))}・
                      {t('replay.orders').replace('{n}', String(recording.events.length))}
                    </span>
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      forgetReplay(recording.playedAt);
                      setReplays(savedReplays());
                    }}
                  >
                    {t('replay.forget')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="field-label">{t('replay.openFile')}</div>
        <p className="hint-text">{t('replay.openFileHint')}</p>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="text-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void openFile(file);
          }}
        />
      </div>

      <button className="btn btn-ghost" onClick={onBack}>
        {t('menu.back')}
      </button>
    </div>
  );
}
