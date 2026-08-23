/**
 * Two people talking (docs/game-design.md 15.9).
 *
 * The relay carries this exactly as it carries everything else — unread —
 * so a line of chat is one browser saying something to one other browser.
 * Which also means it arrives from a stranger's machine, and is treated like
 * anything else that does: checked for shape, flattened, and cut to a length,
 * before it is ever put on screen.
 *
 * The log outlives the lobby. Whatever the two of them said while agreeing
 * the board is still there once the match starts, because from their side it
 * was one conversation.
 */
export interface ChatLine {
  id: number;
  from: 'me' | 'them';
  text: string;
}

/** Long enough for a sentence, short enough not to be a payload. */
export const CHAT_MAX_CHARS = 200;

/** How much of the conversation is kept. */
export const CHAT_KEEP = 60;

/**
 * A line of chat off the wire, or nothing.
 *
 * Newlines are flattened rather than kept: they are the cheapest way to push
 * everything else off somebody's screen, and nothing worth saying here needs
 * them.
 */
export function asChatText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_CHARS);
  return text.length > 0 ? text : null;
}

export class ChatLog {
  lines: ChatLine[] = [];
  /** Lines that have arrived since anyone last looked. */
  unread = 0;
  private nextId = 1;

  /** Called whenever there is something new to draw. */
  onChange: () => void = () => {};

  add(from: ChatLine['from'], text: string): void {
    this.lines = [...this.lines, { id: this.nextId++, from, text }].slice(-CHAT_KEEP);
    if (from === 'them') this.unread += 1;
    this.onChange();
  }

  read(): void {
    if (this.unread === 0) return;
    this.unread = 0;
    this.onChange();
  }
}
