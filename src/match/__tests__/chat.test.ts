// Two people talking (docs/game-design.md 15.9).
//
// Every line here arrives from somebody else's browser, which makes it the
// same kind of thing as an order off the wire: shaped-checked before it is
// believed, and cut to a size before it is shown.
import { describe, expect, it } from 'vitest';
import { asChatText, ChatLog, CHAT_KEEP, CHAT_MAX_CHARS } from '../chat';

describe('a line off the wire', () => {
  it('is taken when it is something somebody said', () => {
    expect(asChatText('  往南集結  ')).toBe('往南集結');
  });

  it('is refused when it is not text at all', () => {
    for (const rubbish of [null, undefined, 42, {}, [], { text: 'hello' }]) {
      expect(asChatText(rubbish)).toBeNull();
    }
  });

  it('is refused when it is nothing', () => {
    expect(asChatText('')).toBeNull();
    expect(asChatText('     ')).toBeNull();
  });

  it('is flattened, because newlines are how you clear somebody screen', () => {
    expect(asChatText('one\n\n\ntwo\t\tthree')).toBe('one two three');
  });

  it('is cut to a length, because a message is not a payload', () => {
    const long = asChatText('x'.repeat(5000));
    expect(long).toHaveLength(CHAT_MAX_CHARS);
  });
});

describe('the conversation', () => {
  it('counts what arrived while nobody was looking', () => {
    const log = new ChatLog();
    log.add('me', 'hello');
    expect(log.unread, 'our own words are not news to us').toBe(0);
    log.add('them', 'hi');
    log.add('them', 'ready?');
    expect(log.unread).toBe(2);
    log.read();
    expect(log.unread).toBe(0);
  });

  it('keeps the recent past and lets the rest go', () => {
    const log = new ChatLog();
    for (let i = 0; i < CHAT_KEEP + 20; i++) log.add('them', `line ${i}`);
    expect(log.lines).toHaveLength(CHAT_KEEP);
    expect(log.lines.at(-1)?.text, 'the newest is the one still there').toBe(
      `line ${CHAT_KEEP + 19}`,
    );
  });

  it('says when there is something to draw', () => {
    const log = new ChatLog();
    let told = 0;
    log.onChange = () => (told += 1);
    log.add('them', 'hello');
    log.read();
    log.read();
    expect(told, 'once for the line, once for reading it, not again').toBe(2);
  });
});
