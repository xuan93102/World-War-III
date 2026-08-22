// The relay (docs/game-design.md 15.4), as a Cloudflare Worker.
//
// It knows about rooms and nothing else. Two players find each other by a
// code, and after that every message is passed through untouched — the relay
// never parses a game message, never holds game state, and could not cheat if
// it wanted to. The authority is the host's browser; this is a post box.
//
// The shape here differs from an ordinary server in one way that matters. A
// room is not an entry in a map inside one process, it is a Durable Object:
// one code, one instance, anywhere in the world. A relay that runs on two
// machines and keeps rooms in memory does not have twice the capacity, it has
// two half-rooms — a host on one and a guest on the other never meet. That
// failure cannot be written here, which is the main reason this exists.
//
// Run it locally with `npm run relay`.
import { DurableObject } from 'cloudflare:workers';

/** No look-alike characters: a code gets read aloud down a phone. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/**
 * A snapshot is a few kilobytes. Anything a hundred times that size is not a
 * game message, and there's no reason to find out what it is.
 */
const MAX_PAYLOAD_BYTES = 256 * 1024;

/**
 * Messages one socket may send per second, and how many it may bunch up.
 *
 * A host posts five snapshots a second and a guest clicks at human speed, so
 * forty is generous by a wide margin — this is here to stop a flood, not to
 * pace a game.
 */
const MESSAGES_PER_SECOND = 40;
const BURST = 80;

/** Dropped messages in a row before we stop believing it's a game at all. */
const FLOOD_LIMIT = 200;

/**
 * How long a room is held open for somebody who dropped out of it.
 *
 * A wifi blip, a lid closing, a phone changing networks: the match is still
 * sitting in the other player's browser, and throwing the room away the
 * instant a socket dies would end matches that nobody meant to end.
 */
const RECONNECT_GRACE_MS = 180_000;

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

const isCode = (value) => typeof value === 'string' && /^[A-Z0-9]{6}$/.test(value);

function send(socket, message) {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // Already gone. The close handler will tidy up.
  }
}

/**
 * One room. Its identity is its code, so there is exactly one of these per
 * code no matter which datacentre the two players reach.
 */
export class Room extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.state = state;
    // Per-socket flood buckets. These live only as long as the instance is
    // awake, and that is the right lifetime: a socket quiet enough for the
    // room to hibernate has, by definition, not been flooding anything.
    this.buckets = new WeakMap();
  }

  async fetch(request) {
    const code = new URL(request.url).pathname.slice('/r/'.length);
    const { 0: client, 1: server } = new WebSocketPair();

    // Hibernation, and the reason this costs nothing to leave running: a room
    // with two idle players is evicted from memory and billed for no time at
    // all, then brought back when either of them says something. Sockets
    // survive that, which ordinary in-memory servers cannot do.
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ role: null, code });

    // Somebody is here, so the room is not abandoned.
    await this.state.storage.deleteAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Everyone still connected, minus one we know is on the way out. */
  live(except) {
    return this.state.getWebSockets().filter((socket) => socket !== except);
  }

  roleOf(socket) {
    return socket.deserializeAttachment()?.role ?? null;
  }

  seat(socket, role) {
    socket.serializeAttachment({ ...socket.deserializeAttachment(), role });
  }

  occupant(role, except) {
    return this.live(except).find((socket) => this.roleOf(socket) === role) ?? null;
  }

  /** A bucket that fills back up over time: bursts are fine, a firehose is not. */
  allow(socket) {
    const now = Date.now();
    const bucket = this.buckets.get(socket) ?? { tokens: BURST, refilled: now, dropped: 0 };
    bucket.tokens = Math.min(
      BURST,
      bucket.tokens + ((now - bucket.refilled) / 1000) * MESSAGES_PER_SECOND,
    );
    bucket.refilled = now;
    this.buckets.set(socket, bucket);

    if (bucket.tokens < 1) {
      bucket.dropped += 1;
      if (bucket.dropped > FLOOD_LIMIT) socket.close(1008, 'flood');
      return false;
    }
    bucket.tokens -= 1;
    bucket.dropped = 0;
    return true;
  }

  async webSocketMessage(socket, raw) {
    if (typeof raw !== 'string') return; // We speak JSON text and nothing else.
    if (raw.length > MAX_PAYLOAD_BYTES) return socket.close(1009, 'too big');
    if (!this.allow(socket)) return;

    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return; // Not ours. Say nothing.
    }
    if (typeof message !== 'object' || message === null) return;

    const { code } = socket.deserializeAttachment();

    if (message.t === 'host') {
      if (this.roleOf(socket)) return;
      const token = await this.state.storage.get('token');

      // Coming back to a room we opened. The token is what makes this safe:
      // the code alone is shouted down a phone and shared in chat, so anyone
      // who heard it could otherwise walk into the empty host seat of a match
      // in progress.
      if (typeof message.token === 'string') {
        if (!token || token !== message.token || this.occupant('host')) {
          return send(socket, { t: 'error', why: 'noRoom' });
        }
      } else if (token) {
        // A fresh room was asked for and this code is already somebody's.
        return send(socket, { t: 'error', why: 'roomFull' });
      }

      const key = token ?? newCode() + newCode();
      if (!token) await this.state.storage.put('token', key);
      this.seat(socket, 'host');
      send(socket, { t: 'room', code, token: key });

      const guest = this.occupant('guest', socket);
      if (guest) {
        send(socket, { t: 'peer' });
        send(guest, { t: 'peer' });
      }
      return;
    }

    if (message.t === 'join') {
      if (this.roleOf(socket)) return;
      const host = this.occupant('host', socket);
      if (!(await this.state.storage.get('token')) || !host) {
        return send(socket, { t: 'error', why: 'noRoom' });
      }
      if (this.occupant('guest', socket)) return send(socket, { t: 'error', why: 'roomFull' });

      this.seat(socket, 'guest');
      send(socket, { t: 'joined', code });
      send(host, { t: 'peer' });
      // The one coming back needs to know somebody is still there too.
      send(socket, { t: 'peer' });
      return;
    }

    if (message.t === 'msg') {
      const role = this.roleOf(socket);
      if (!role) return;
      const peer = this.occupant(role === 'host' ? 'guest' : 'host', socket);
      // Straight through, unread. Whatever the two of them are saying to each
      // other is between them.
      if (peer) send(peer, { t: 'msg', data: message.data });
    }
  }

  async webSocketClose(socket) {
    const role = this.roleOf(socket);
    const others = this.live(socket);
    if (role) for (const other of others) send(other, { t: 'gone' });

    // Nobody left. Hold the room a while — a dropped socket is not a match
    // that ended — but don't hold it forever.
    if (others.length === 0) {
      await this.state.storage.setAlarm(Date.now() + RECONNECT_GRACE_MS);
    }
  }

  webSocketError(socket) {
    socket.close(1011, 'error');
  }

  async alarm() {
    // Still nobody. The match is over whether or not anyone said so.
    if (this.state.getWebSockets().length === 0) await this.state.storage.deleteAll();
  }
}

/**
 * Which pages may use this relay, as a comma-separated ALLOWED_ORIGINS. Unset
 * means anyone, which is right for running it on your own machine and wrong
 * for leaving it on the internet.
 *
 * Worth being clear about what this is: a browser sends Origin and cannot lie
 * about it, so this stops *other websites* pointing their players at your
 * relay. Anything that isn't a browser can put whatever it likes in that
 * header, so it is a door, not a wall.
 */
function permitted(request, env) {
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return allowed.length === 0 || allowed.includes(request.headers.get('Origin') ?? '');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Somewhere for a hosting platform to ask whether this is alive. It says
    // nothing about who is playing or what: this endpoint is public, and
    // unlike a single-process relay there is no global room count to give —
    // each room is its own instance and none of them are asked.
    if (url.pathname === '/health' || url.pathname === '/') {
      return Response.json({ ok: true });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected a websocket', { status: 426 });
    }
    if (!permitted(request, env)) return new Response('origin', { status: 403 });

    // Which room. The code is in the path because a Durable Object has to be
    // chosen before the socket opens, whereas an ordinary server can wait and
    // let the client say so afterwards.
    let code;
    if (url.pathname === '/new') code = newCode();
    else if (url.pathname.startsWith('/r/')) code = url.pathname.slice('/r/'.length).toUpperCase();
    else return new Response('not found', { status: 404 });
    if (!isCode(code)) return new Response('not a room code', { status: 400 });

    const room = env.ROOM.get(env.ROOM.idFromName(code));
    return room.fetch(new Request(`https://room/r/${code}`, request));
  },
};
