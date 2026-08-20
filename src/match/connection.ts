import { asRelayMessage, type GuestMessage, type HostMessage } from './protocol';

/**
 * One end of a networked match (docs/game-design.md 15.4).
 *
 * A thin wrapper over the socket: it owns the room handshake and hands
 * everything else to whoever is listening. It deliberately knows nothing
 * about the game — the host loop and the guest loop are the ones that care
 * what a snapshot or an order is.
 */
export type ConnectionState =
  | { at: 'connecting' }
  | { at: 'hosting'; code: string }
  | { at: 'waiting'; code: string }
  | { at: 'together'; code: string }
  | { at: 'gone' }
  | { at: 'failed'; why: 'noRoom' | 'roomFull' | 'noRelay' };

export const DEFAULT_RELAY_URL =
  import.meta.env?.VITE_RELAY_URL ?? `ws://${location.hostname}:8787`;

export class Connection {
  private socket: WebSocket;
  private opening: 'host' | { code: string };

  /** Called whenever the room's situation changes. */
  onState: (state: ConnectionState) => void = () => {};
  /** Called with whatever the other end sent, unread. */
  onMessage: (data: unknown) => void = () => {};

  state: ConnectionState = { at: 'connecting' };

  constructor(opening: 'host' | { code: string }, url: string = DEFAULT_RELAY_URL) {
    this.opening = opening;
    this.socket = new WebSocket(url);
    this.socket.onopen = () => {
      this.socket.send(
        JSON.stringify(
          this.opening === 'host' ? { t: 'host' } : { t: 'join', code: this.opening.code },
        ),
      );
    };
    this.socket.onerror = () => this.moveTo({ at: 'failed', why: 'noRelay' });
    this.socket.onclose = () => {
      if (this.state.at !== 'failed') this.moveTo({ at: 'gone' });
    };
    this.socket.onmessage = (event) => this.receive(event.data);
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
        return this.moveTo({ at: 'hosting', code: message.code });
      case 'joined':
        // The guest is in the room the moment it joins; the host is only
        // together with someone once that happens.
        return this.moveTo({ at: 'together', code: message.code });
      case 'peer': {
        const code = 'code' in this.state ? this.state.code : '';
        return this.moveTo({ at: 'together', code });
      }
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
    this.socket.onclose = null;
    this.socket.close();
  }
}
