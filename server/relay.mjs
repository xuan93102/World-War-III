// The relay (docs/game-design.md 15.4).
//
// It knows about rooms and nothing else. Two players find each other by a
// code, and after that every message is passed through untouched — the relay
// never parses a game message, never holds game state, and could not cheat if
// it wanted to. The authority is the host's browser; this is a post box.
//
// Run it with `npm run relay`. Put it near the players: a relay on the wrong
// continent turns a 40ms round trip into 300ms, which costs more than any
// choice of architecture.
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8787);

/** No look-alike characters: a code gets read aloud down a phone. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/** Rooms with nobody in them are swept after this long. */
const EMPTY_ROOM_MS = 60_000;

/** code -> { host, guest } */
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

const server = new WebSocketServer({ port: PORT });

server.on('connection', (socket) => {
  socket.room = null;

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return; // Not ours. Say nothing.
    }
    if (typeof message !== 'object' || message === null) return;

    if (message.t === 'host') {
      const code = newCode();
      rooms.set(code, { host: socket, guest: null, emptySince: null });
      socket.room = code;
      send(socket, { t: 'room', code });
      return;
    }

    if (message.t === 'join') {
      const code = typeof message.code === 'string' ? message.code.toUpperCase() : '';
      const room = rooms.get(code);
      if (!room) return send(socket, { t: 'error', why: 'noRoom' });
      if (room.guest) return send(socket, { t: 'error', why: 'roomFull' });
      room.guest = socket;
      room.emptySince = null;
      socket.room = code;
      send(socket, { t: 'joined', code });
      send(room.host, { t: 'peer' });
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
    const room = rooms.get(socket.room);
    if (!room) return;
    const peer = peerOf(room, socket);
    send(peer, { t: 'gone' });
    if (room.host === socket) room.host = null;
    else room.guest = null;
    if (!room.host && !room.guest) {
      room.emptySince = Date.now();
    }
  });
});

// A room whose players both walked away is rubbish; sweep it so the codes
// stay short and stay reusable.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.emptySince !== null && now - room.emptySince > EMPTY_ROOM_MS) rooms.delete(code);
  }
}, EMPTY_ROOM_MS).unref();

console.log(`relay listening on ws://localhost:${PORT}`);
