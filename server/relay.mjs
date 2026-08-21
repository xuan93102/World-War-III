// The relay (docs/game-design.md 15.4).
//
// It knows about rooms and nothing else. Two players find each other by a
// code, and after that every message is passed through untouched — the relay
// never parses a game message, never holds game state, and could not cheat if
// it wanted to. The authority is the host's browser; this is a post box.
//
// Run it locally with `npm run relay`. Deployed, it faces the open internet,
// so everything below that isn't about rooms is about not trusting anyone:
// message sizes are capped, dead sockets are found and dropped, and a
// connection that never joins a room doesn't get to sit there forever.
//
// Put it near the players. A relay on the wrong continent turns a 40ms round
// trip into 300ms, which costs more than any choice of architecture.
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8787);

/** No look-alike characters: a code gets read aloud down a phone. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/** How often the sweeper looks for rooms nobody came back to. */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * A snapshot is a few kilobytes and compresses to about one. Anything a
 * hundred times that size is not a game message, and there's no reason to
 * find out what it is.
 */
const MAX_PAYLOAD_BYTES = 256 * 1024;

/** How many matches this thing will hold at once before turning people away. */
const MAX_ROOMS = 200;

/**
 * A socket that has neither opened nor joined a room in this long is not
 * playing anything. Sockets are cheap but they aren't free.
 */
const LOBBY_GRACE_MS = 120_000;

/** Sockets that stop answering are dropped after two missed rounds. */
const HEARTBEAT_MS = 30_000;

/**
 * How long a room is held open for somebody who dropped out of it.
 *
 * A wifi blip, a lid closing, a phone changing networks: the match is still
 * sitting in the other player's browser, and throwing the room away the
 * instant a socket dies would end matches that nobody meant to end.
 */
const RECONNECT_GRACE_MS = 180_000;

/** code -> { host, guest, emptySince, token } */
const rooms = new Map();

function newCode() {
  let code;
  do {
    code = Array.from(
      { length: CODE_LENGTH },
      () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
    ).join('');
  } while (rooms.has(code));
  return code;
}

function send(socket, message) {
  if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

/** The other person in this room, whoever we are. */
function peerOf(room, socket) {
  return room.host === socket ? room.guest : room.host;
}

// A plain HTTP face as well, because hosting platforms want somewhere to ask
// whether this is alive, and a bare WebSocket server answers everything else
// with a 400.
const http = createServer((request, response) => {
  if (request.url === '/health' || request.url === '/') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  response.writeHead(404).end();
});

const server = new WebSocketServer({
  server: http,
  maxPayload: MAX_PAYLOAD_BYTES,
  /**
   * Snapshots are JSON of the same shape several times a second, which is
   * about the most compressible traffic there is: measured over a socket,
   * fifty changing snapshots went from 8.8 KB each to 0.96. That takes the
   * stream from roughly 80 KB/s to under 5, which is the difference between
   * "fine at home" and "fine on a phone".
   *
   * `ws` leaves this off by default because a deflate context per connection
   * costs memory, so the settings below keep it modest: small windows, no
   * context carried between messages on the client side, and nothing under a
   * kilobyte compressed at all.
   */
  perMessageDeflate: {
    zlibDeflateOptions: { level: 6, memLevel: 7, windowBits: 13 },
    clientNoContextTakeover: true,
    serverMaxWindowBits: 13,
    threshold: 1024,
  },
});

server.on('connection', (socket) => {
  socket.room = null;
  socket.alive = true;

  // Without this the process dies. A socket that breaks a protocol rule — an
  // oversized frame, most obviously — gets an 'error' event, and an 'error'
  // event with no listener is how Node ends a program. One bad message from
  // one stranger would take the relay down for everybody in it.
  socket.on('error', () => socket.terminate());
  socket.on('pong', () => {
    socket.alive = true;
  });

  // Loitering in the lobby is not a use of this server.
  socket.lobbyTimer = setTimeout(() => {
    if (!socket.room) socket.close();
  }, LOBBY_GRACE_MS);

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return; // Not ours. Say nothing.
    }
    if (typeof message !== 'object' || message === null) return;

    if (message.t === 'host') {
      if (socket.room) return;

      // Coming back to a room we opened. The token is what makes this safe:
      // the code alone is shouted down a phone and shared in chat, so anyone
      // who heard it could otherwise walk into the empty host seat of a match
      // in progress.
      if (typeof message.code === 'string' && typeof message.token === 'string') {
        const room = rooms.get(message.code.toUpperCase());
        if (!room || room.host || room.token !== message.token) {
          return send(socket, { t: 'error', why: 'noRoom' });
        }
        room.host = socket;
        room.emptySince = null;
        socket.room = message.code.toUpperCase();
        clearTimeout(socket.lobbyTimer);
        send(socket, { t: 'room', code: socket.room, token: room.token });
        if (room.guest) {
          send(socket, { t: 'peer' });
          send(room.guest, { t: 'peer' });
        }
        return;
      }

      if (rooms.size >= MAX_ROOMS) return send(socket, { t: 'error', why: 'roomFull' });
      const code = newCode();
      const token = newCode() + newCode();
      rooms.set(code, { host: socket, guest: null, emptySince: null, token });
      socket.room = code;
      clearTimeout(socket.lobbyTimer);
      send(socket, { t: 'room', code, token });
      return;
    }

    if (message.t === 'join') {
      if (socket.room) return;
      const code = typeof message.code === 'string' ? message.code.toUpperCase() : '';
      const room = rooms.get(code);
      if (!room) return send(socket, { t: 'error', why: 'noRoom' });
      if (room.guest || !room.host) return send(socket, { t: 'error', why: 'roomFull' });
      room.guest = socket;
      room.emptySince = null;
      socket.room = code;
      clearTimeout(socket.lobbyTimer);
      send(socket, { t: 'joined', code });
      send(room.host, { t: 'peer' });
      // The one coming back needs to know somebody is still there too.
      if (room.host) send(socket, { t: 'peer' });
      return;
    }

    if (message.t === 'msg') {
      const room = rooms.get(socket.room);
      if (!room) return;
      // Straight through, unread. Whatever the two of them are saying to
      // each other is between them.
      send(peerOf(room, socket), { t: 'msg', data: message.data });
    }
  });

  socket.on('close', () => {
    clearTimeout(socket.lobbyTimer);
    const room = rooms.get(socket.room);
    if (!room) return;
    send(peerOf(room, socket), { t: 'gone' });
    if (room.host === socket) room.host = null;
    else room.guest = null;
    if (!room.host && !room.guest) room.emptySince = Date.now();
    else room.emptySince = null;
  });
});

// A browser that goes to sleep, a laptop lid, a tunnel: sockets die without
// saying so, and a room held by a ghost can never be joined.
setInterval(() => {
  for (const socket of server.clients) {
    if (!socket.alive) {
      socket.terminate();
      continue;
    }
    socket.alive = false;
    socket.ping();
  }
}, HEARTBEAT_MS).unref();

// A room whose players both walked away is rubbish; sweep it so the codes
// stay short and stay reusable.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.emptySince !== null && now - room.emptySince > RECONNECT_GRACE_MS) rooms.delete(code);
  }
}, SWEEP_INTERVAL_MS).unref();

// Same reasoning one level up: whatever goes wrong with a listening socket,
// the answer is not to stop relaying for the people already in a room.
server.on('error', (error) => console.error('relay socket error:', error.message));
http.on('clientError', (_error, socket) => socket.destroy());

http.listen(PORT, () => {
  console.log(`relay listening on port ${PORT} (health at /health)`);
});
