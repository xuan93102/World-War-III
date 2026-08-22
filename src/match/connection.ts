import { asRelayMessage, type GuestMessage, type HostMessage } from './protocol';

/**
 * One end of a networked match (docs/game-design.md 15.4, 15.8).
 *
 * A thin wrapper over the socket: it owns the room handshake and hands
 * everything else to whoever is listening. It deliberately knows nothing
 * about the game — the host loop and the guest loop are the ones that care
 * what a snapshot or an order is.
 *
 * It also owns getting back in. A socket that dies is not a match that ended:
 * a lid closes, a phone changes network, a train goes into a tunnel, and the
 * match is still sitting in both browsers waiting to carry on. So a dropped
 * socket is retried, and the room is walked back into rather than opened
 * afresh — a new room would leave the other player holding a code that no
 * longer means anything.
 */
export type ConnectionState =
  | { at: 'connecting' }
  | { at: 'hosting'; code: string }
  | { at: 'waiting'; code: string }
  | { at: 'together'; code: string }
  /** Our own socket died and we are trying to get back in. */
  | { at: 'reconnecting'; code: string }
  /** The other side's socket died; the room is held for them a while. */
  | { at: 'gone' }
  | { at: 'failed'; why: 'noRoom' | 'roomFull' | 'noRelay' };

export const DEFAULT_RELAY_URL =
  import.meta.env?.VITE_RELAY_URL ??
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8787`;

/** Waits between attempts, backing off so a dead relay isn't hammered. */
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000];

/**
 * How to get into a room: open a new one, join somebody else's by code, or
 * walk back into our own — which needs the token, because a code on its own
 * is something anybody who heard it could use.
 */
export type Opening = 'host' | { code: string } | { code: string; token: string };

const reclaiming = (opening: Opening): opening is { code: string; token: string } =>
  typeof opening === 'object' && 'token' in opening;

export class Connection {
  private socket!: WebSocket;
  private readonly opening: Opening;
  private readonly url: string;
  /** Handed out when we opened the room; our key back into it. */
  private token: string | null = null;
  private code: string | null = null;
  private attempt = 0;
  private closing = false;

  /** Called whenever the room's situation changes. */
  onState: (state: ConnectionState) => void = () => {};
  /** Called with whatever the other end sent, unread. */
  onMessage: (data: unknown) => void = () => {};

  state: ConnectionState = { at: 'connecting' };

  constructor(opening: Opening, url: string = DEFAULT_RELAY_URL) {
    this.opening = opening;
    this.url = url;
    // A room we are returning to is one we already know the way into, so the
    // first greeting can claim it rather than ask for a new one.
    if (reclaiming(opening)) {
      this.code = opening.code;
      this.token = opening.token;
    }
    this.dial();
  }

  /** What we would need to walk back into this room after a reload. */
  get room(): { code: string; token: string | null } | null {
    return this.code ? { code: this.code, token: this.token } : null;
  }

  /**
   * Which room to knock on. The code goes in the address rather than in the
   * first message because the relay has to pick the room before the socket
   * opens — one room is one Durable Object, chosen by its code. Asking for a
   * room we have no code for yet is what `/new` means.
   */
  private address() {
    const base = this.url.replace(/\/+$/, '');
    const code = this.code ?? (this.opening === 'host' ? null : this.opening.code);
    return code ? `${base}/r/${code}` : `${base}/new`;
  }

  private dial() {
    this.socket = new WebSocket(this.address());
    this.socket.onopen = () => {
      this.attempt = 0;
      this.socket.send(JSON.stringify(this.greeting()));
    };
    this.socket.onerror = () => {
      // An error is always followed by a close, which is where retrying lives.
    };
    this.socket.onclose = () => {
      if (this.closing) return;
      this.retryOrGiveUp();
    };
    this.socket.onmessage = (event) => this.receive(event.data);
  }

  /** What we say on connecting: open a room, walk back into ours, or join. */
  private greeting() {
    if (this.opening === 'host' || reclaiming(this.opening)) {
      return this.code && this.token
        ? { t: 'host', code: this.code, token: this.token }
        : { t: 'host' };
    }
    return { t: 'join', code: this.code ?? this.opening.code };
  }

  private retryOrGiveUp() {
    const delay = RETRY_DELAYS_MS[this.attempt];
    if (delay === undefined) {
      // Long enough. Whatever is wrong is not going to fix itself in another
      // few seconds, and pretending otherwise just hides it.
      return this.moveTo({ at: 'failed', why: 'noRelay' });
    }
    this.attempt += 1;
    this.moveTo({ at: 'reconnecting', code: this.code ?? '' });
    setTimeout(() => {
      if (!this.closing) this.dial();
    }, delay);
  }

  private moveTo(state: ConnectionState) {
    this.state = state;
    this.onState(state);
  }

  private receive(raw: unknown) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return;
    }
    const message = asRelayMessage(parsed);
    if (!message) return;

    switch (message.t) {
      case 'room':
        this.code = message.code;
        this.token = message.token;
        return this.moveTo({ at: 'hosting', code: message.code });
      case 'joined':
        // The guest is in the room the moment it joins; the host is only
        // together with someone once that happens.
        this.code = message.code;
        return this.moveTo({ at: 'together', code: message.code });
      case 'peer':
        return this.moveTo({ at: 'together', code: this.code ?? '' });
      case 'gone':
        return this.moveTo({ at: 'gone' });
      case 'error':
        return this.moveTo({ at: 'failed', why: message.why });
      case 'msg':
        return this.onMessage(message.data);
    }
  }

  /** Sends to the other end. Silently does nothing if there isn't one yet. */
  send(data: HostMessage | GuestMessage): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ t: 'msg', data }));
  }

  close(): void {
    this.closing = true;
    this.socket.onclose = null;
    this.socket.close();
  }
}
