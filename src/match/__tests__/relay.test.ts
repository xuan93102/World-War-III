// The relay's room rules (docs/game-design.md 15.4, 15.8), against the real
// server rather than a stand-in for it. A dropped socket is not a match that
// ended, so a room is held open — and holding it open is exactly what creates
// somewhere for a stranger to walk into, which is what the token is for.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = 8791;
const URL = `ws://127.0.0.1:${PORT}`;

let relay: ChildProcess;

/** A client that remembers everything it was told. */
function connect(): Promise<WebSocket & { seen: Record<string, unknown>[] }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(URL) as WebSocket & { seen: Record<string, unknown>[] };
    socket.seen = [];
    socket.on('error', () => {});
    socket.on('message', (raw) => socket.seen.push(JSON.parse(raw.toString())));
    socket.on('open', () => resolve(socket));
  });
}

const say = (socket: WebSocket, message: unknown) => socket.send(JSON.stringify(message));
const settle = () => new Promise((r) => setTimeout(r, 250));
const sawA = (socket: { seen: Record<string, unknown>[] }, t: string) =>
  socket.seen.filter((m) => m.t === t);

beforeAll(async () => {
  relay = spawn(process.execPath, ['server/relay.mjs'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  // Give it a moment to bind before anybody knocks. Asked over HTTP because
  // a WebSocket that can't connect reports it by an event, not a rejection —
  // waiting on one that never opens waits forever.
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const health = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (health.ok) return;
    } catch {
      // Not up yet.
    }
    await settle();
  }
  throw new Error('the relay never came up');
}, 30000);

afterAll(() => relay?.kill());

describe('a room somebody dropped out of', () => {
  it('is held open, and its owner can walk back in with the token', async () => {
    const host = await connect();
    say(host, { t: 'host' });
    await settle();
    const opened = sawA(host, 'room')[0] as { code: string; token: string };
    expect(opened.code, 'a code to read out').toHaveLength(6);
    expect(opened.token, 'and a key to keep').toBeTruthy();

    const guest = await connect();
    say(guest, { t: 'join', code: opened.code });
    await settle();
    expect(sawA(guest, 'peer'), 'told somebody is already there').toHaveLength(1);

    // The host's socket dies without warning, the way a network does.
    host.terminate();
    await settle();
    expect(sawA(guest, 'gone'), 'the guest is told').toHaveLength(1);

    // And the host comes back to the same room, not a new one.
    const back = await connect();
    say(back, { t: 'host', code: opened.code, token: opened.token });
    await settle();
    expect((sawA(back, 'room')[0] as { code: string })?.code, 'the same room').toBe(opened.code);
    expect(sawA(guest, 'peer').length, 'and the guest is told they are back').toBe(2);

    // The two of them can talk again.
    say(back, { t: 'msg', data: { t: 'snapshot', state: 'carrying on' } });
    await settle();
    expect((guest.seen.at(-1) as { data?: { state?: string } })?.data?.state).toBe('carrying on');

    back.close();
    guest.close();
  });

  it('is not somewhere a stranger with the code can sit down', async () => {
    const host = await connect();
    say(host, { t: 'host' });
    await settle();
    const opened = sawA(host, 'room')[0] as { code: string; token: string };
    host.terminate();
    await settle();

    // A code is shouted down a phone and pasted into chat. On its own it must
    // not be enough to take over an empty host seat.
    const stranger = await connect();
    say(stranger, { t: 'host', code: opened.code, token: 'DEFINITELY-NOT-IT' });
    await settle();
    expect(sawA(stranger, 'error')[0], 'turned away').toEqual({ t: 'error', why: 'noRoom' });
    expect(sawA(stranger, 'room'), 'and given no room').toHaveLength(0);

    // Nor is asking without one at all.
    say(stranger, { t: 'host', code: opened.code });
    await settle();
    // No token means this reads as "open me a room", which is fine — but it
    // must be a *different* room, not the one that was already there.
    const given = sawA(stranger, 'room')[0] as { code: string } | undefined;
    expect(given?.code).not.toBe(opened.code);

    stranger.close();
  });

  it('will not let the seat be taken while its owner is still in it', async () => {
    const host = await connect();
    say(host, { t: 'host' });
    await settle();
    const opened = sawA(host, 'room')[0] as { code: string; token: string };

    // Even with the right token: there is somebody in that chair.
    const twin = await connect();
    say(twin, { t: 'host', code: opened.code, token: opened.token });
    await settle();
    expect(sawA(twin, 'error')[0]).toEqual({ t: 'error', why: 'noRoom' });

    host.close();
    twin.close();
  });
});
