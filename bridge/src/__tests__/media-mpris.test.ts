import { describe, expect, it } from 'vitest';
import { choosePlayer, parsePlayers, parseRates, playerLabel, stepRate, toMessage, worthSending } from '../media-mpris.js';

const S = '\u001f';
const line = (...f: string[]) => f.join(S);

describe('media-mpris', () => {
  it('parses playerctl -a metadata output', () => {
    const out = [
      line('firefox.instance_1_42', 'Playing', '61500000', '240000000', 'Some video', 'Channel'),
      line('plezy', 'Paused', '', '', 'Episode 3', ''),
      'No players found',
    ].join('\n');
    const p = parsePlayers(out);
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ instance: 'firefox.instance_1_42', status: 'playing', positionMs: 61500, lengthMs: 240000, title: 'Some video', artist: 'Channel' });
    expect(p[1]).toMatchObject({ status: 'paused', positionMs: 0, lengthMs: 0 });
    expect(playerLabel(p[0].instance)).toBe('firefox');
  });

  it('prefers a pinned, then the newest playing player', () => {
    const p = parsePlayers([
      line('a', 'Playing', '0', '1', 't', ''), line('b', 'Playing', '0', '1', 't', ''), line('c', 'Paused', '0', '1', 't', ''),
    ].join('\n'));
    const started = new Map([['a', 1], ['b', 2]]);
    expect(choosePlayer(p, undefined, undefined, started)?.instance).toBe('b');
    expect(choosePlayer(p, undefined, 'c', started)?.instance).toBe('c');
    expect(choosePlayer(p.filter((x) => x.status !== 'playing'), 'a', undefined, started)?.instance).toBe('c');
  });

  it('sends only on change or an unexpected position jump', () => {
    const [pl] = parsePlayers(line('mpv', 'Playing', '10000000', '100000000', 't', ''));
    const m = toMessage(pl, 1);
    expect(worthSending(undefined, 0, m, 0)).toBe(true);
    const later = { ...m, positionMs: 12_000 };
    expect(worthSending(m, 0, later, 2_000)).toBe(false);          // played on as predicted
    expect(worthSending(m, 0, { ...m, positionMs: 50_000 }, 2_000)).toBe(true);   // seek
    expect(worthSending(m, 0, { ...m, status: 'paused' }, 100)).toBe(true);
    expect(worthSending(m, 0, { ...later, rate: 1.5 }, 2_000)).toBe(true);
  });

  it('reads and steps playback speed', () => {
    expect(parseRates('d 1.5\nd 0.25\nd 4\n')).toEqual({ rate: 1.5, minRate: 0.25, maxRate: 4 });
    expect(parseRates('d 1\n')).toBeUndefined();
    expect(stepRate(1, 1, 0.25, 4)).toBe(1.25);
    expect(stepRate(1, -1, 0.25, 4)).toBe(0.75);
    expect(stepRate(2, 1, 0.5, 2)).toBe(2);
    expect(stepRate(1.1, 1, 0.25, 4)).toBe(1.25);
    expect(toMessage({ instance: 'x', status: 'playing', positionMs: 0, lengthMs: 0, title: '', artist: '', rate: 1, minRate: 1, maxRate: 1 }, 1).canRate).toBe(false);
  });
});
