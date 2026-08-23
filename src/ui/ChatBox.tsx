import { useEffect, useRef, useState } from 'react';
import { CHAT_MAX_CHARS, type ChatLog } from '../match/chat';
import { useSettings } from '../settings/useSettings';

interface ChatBoxProps {
  log: ChatLog;
  onSend: (text: string) => void;
}

/**
 * The conversation, wherever it is being had (docs 15.9).
 *
 * The same box serves the lobby and the match, because it is the same two
 * people and the same conversation — only the screen around it changes.
 */
export function ChatBox({ log, onSend }: ChatBoxProps) {
  const { t } = useSettings();
  const [draft, setDraft] = useState('');
  const bottom = useRef<HTMLDivElement | null>(null);

  // Newest at the bottom, and stay there. Anything else means the interesting
  // line is the one you cannot see.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [log.lines.length]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  return (
    <div className="chat">
      <div className="chat-lines">
        {log.lines.length === 0 && <p className="hint-text">{t('chat.empty')}</p>}
        {log.lines.map((line) => (
          <p key={line.id} className={`chat-line chat-line-${line.from}`}>
            <span className="chat-who">{t(line.from === 'me' ? 'chat.me' : 'chat.them')}</span>
            {line.text}
          </p>
        ))}
        <div ref={bottom} />
      </div>
      <div className="chat-entry">
        <input
          className="text-input"
          value={draft}
          maxLength={CHAT_MAX_CHARS}
          placeholder={t('chat.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
            // The match is listening for keys too; a message about retreating
            // should not also order one.
            e.stopPropagation();
          }}
        />
        <button className="btn btn-sm" onClick={send} disabled={!draft.trim()}>
          {t('chat.send')}
        </button>
      </div>
    </div>
  );
}
