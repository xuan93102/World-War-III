import { useMemo, useState } from 'react';
import { useSettings } from '../../settings/useSettings';

interface PvpLobbyProps {
  onBack: () => void;
}

// Local-only placeholder code so the lobby has something concrete to show.
// Real room codes will come from the server once networking exists.
function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes (I/O/0/1)
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export function PvpLobby({ onBack }: PvpLobbyProps) {
  const { t } = useSettings();
  const roomCode = useMemo(generateRoomCode, []);
  const [copied, setCopied] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked without a secure context / permission;
      // the code is displayed on screen anyway so this is non-fatal.
    }
  };

  return (
    <div className="screen screen-centered">
      <h2 className="screen-title">{t('pvp.title')}</h2>

      <p className="notice">{t('pvp.notImplemented')}</p>

      <div className="panel">
        <div className="field-label">{t('pvp.roomCode')}</div>
        <div className="room-code-row">
          <code className="room-code">{roomCode}</code>
          <button className="btn btn-sm" onClick={copyCode}>
            {copied ? t('pvp.copied') : t('pvp.copy')}
          </button>
        </div>
        <div className="waiting-row">
          <span className="spinner" aria-hidden="true" />
          {t('pvp.waiting')}
        </div>
      </div>

      <div className="panel">
        <label className="field-label" htmlFor="join-code">
          {t('pvp.joinLabel')}
        </label>
        <div className="room-code-row">
          <input
            id="join-code"
            className="text-input"
            placeholder={t('pvp.joinPlaceholder')}
            value={joinCode}
            maxLength={6}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          />
          <button className="btn btn-sm" disabled={joinCode.length !== 6}>
            {t('pvp.join')}
          </button>
        </div>
      </div>

      <button className="btn btn-ghost" onClick={onBack}>
        {t('menu.back')}
      </button>
    </div>
  );
}
