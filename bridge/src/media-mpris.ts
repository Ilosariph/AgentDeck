/**
 * Now-playing + timeline scrubbing for boards that advertise `media` (the
 * Waveshare 3.49 strip): the desktop's MPRIS players (Firefox/YouTube, Plezy,
 * mpv, Spotify…) read and driven through `playerctl`.
 *
 * The daemon polls once a second while such a board is attached and sends a
 * `media_state` frame only when something a viewer would notice changed: a
 * different track/player/status, or a position jump (seek) the board could not
 * have predicted. Between frames the board advances the position itself.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface MprisPlayer {
  /** playerctl instance name (`firefox.instance_1_42`), the -p target. */
  instance: string;
  status: 'playing' | 'paused' | 'stopped';
  positionMs: number;
  lengthMs: number;
  title: string;
  artist: string;
  /** Playback speed (MPRIS Rate); 1 when the player does not say. */
  rate: number;
  minRate: number;
  maxRate: number;
}

export interface MediaStateMessage {
  type: 'media_state';
  /** Short player name (instance suffix dropped); '' when nothing plays. */
  player: string;
  status: 'playing' | 'paused' | 'stopped' | 'none';
  title: string;
  artist: string;
  positionMs: number;
  lengthMs: number;
  /** Players found, so the board can offer switching. */
  players: number;
  rate: number;
  /** The player accepts a different speed (MinimumRate < MaximumRate). */
  canRate: boolean;
  /** Host local time of day at sending (ms since local midnight), for "ends at". */
  localDayMs?: number;
}

/** Milliseconds since local midnight: the board's clock may not be set (USB only, no NTP). */
export function localDayMs(now = new Date()): number {
  return ((now.getHours() * 60 + now.getMinutes()) * 60 + now.getSeconds()) * 1000 + now.getMilliseconds();
}

export type MediaAction = 'toggle' | 'next' | 'previous' | 'seek' | 'seek_by' | 'cycle' | 'rate';

/** Speeds the board steps through (clamped to what the player allows). */
export const RATE_STEPS = Array.from({ length: 14 }, (_, i) => (i + 1) / 4);   // 0.25 … 3.5

const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const MPRIS_PLAYER = 'org.mpris.MediaPlayer2.Player';
const busName = (instance: string) => `org.mpris.MediaPlayer2.${instance}`;

const SEP = '\u001f';
const FORMAT = ['{{playerInstance}}', '{{status}}', '{{position}}', '{{mpris:length}}',
  '{{xesam:title}}', '{{xesam:artist}}'].join(SEP);

/** Parse `playerctl -a metadata --format FORMAT` output. */
export function parsePlayers(stdout: string): MprisPlayer[] {
  const out: MprisPlayer[] = [];
  for (const line of stdout.split('\n')) {
    const f = line.split(SEP);
    if (f.length < 6 || !f[0]) continue;
    const status = f[1].toLowerCase();
    out.push({
      instance: f[0],
      status: status === 'playing' || status === 'paused' ? status : 'stopped',
      positionMs: Math.max(0, Math.round(Number(f[2]) / 1000) || 0),
      lengthMs: Math.max(0, Math.round(Number(f[3]) / 1000) || 0),
      title: f[4].trim(),
      artist: f.slice(5).join(' ').trim(),
      rate: 1, minRate: 1, maxRate: 1,
    });
  }
  return out;
}

/** `firefox.instance_1_42` → `firefox`. */
export function playerLabel(instance: string): string {
  return instance.split('.')[0] ?? instance;
}

/**
 * Which player the board shows: an explicit pick while it exists, else the
 * playing one (the most recently started when several play), else whatever
 * was shown, else the first paused one.
 */
export function choosePlayer(players: MprisPlayer[], current: string | undefined, pinned: string | undefined,
  startedAt: Map<string, number>): MprisPlayer | undefined {
  if (pinned) {
    const p = players.find((x) => x.instance === pinned);
    if (p) return p;
  }
  const playing = players.filter((p) => p.status === 'playing');
  if (playing.length) {
    return playing.reduce((a, b) => ((startedAt.get(b.instance) ?? 0) > (startedAt.get(a.instance) ?? 0) ? b : a));
  }
  return players.find((p) => p.instance === current)
    ?? players.find((p) => p.status === 'paused')
    ?? players[0];
}

/** `busctl get-property … Rate MinimumRate MaximumRate` → three doubles ("d 1.5" lines). */
export function parseRates(stdout: string): { rate: number; minRate: number; maxRate: number } | undefined {
  const v = stdout.split('\n').map((l) => /^d\s+(\S+)/.exec(l.trim())?.[1]).filter((x) => x !== undefined).map(Number);
  if (v.length < 3 || v.some((x) => !Number.isFinite(x) || x <= 0)) return undefined;
  return { rate: v[0], minRate: v[1], maxRate: v[2] };
}

/** Next speed step up (dir 1) or down (dir -1) from `rate`, within the player's range. */
export function stepRate(rate: number, dir: 1 | -1, minRate: number, maxRate: number): number {
  const steps = RATE_STEPS.filter((s) => s >= minRate - 1e-6 && s <= maxRate + 1e-6);
  if (!steps.length) return rate;
  const next = dir > 0 ? steps.find((s) => s > rate + 1e-6) : [...steps].reverse().find((s) => s < rate - 1e-6);
  return next ?? (dir > 0 ? steps[steps.length - 1] : steps[0]);
}

export function toMessage(p: MprisPlayer | undefined, players: number): MediaStateMessage {
  if (!p) return { type: 'media_state', player: '', status: 'none', title: '', artist: '', positionMs: 0, lengthMs: 0, players, rate: 1, canRate: false };
  return {
    type: 'media_state', player: playerLabel(p.instance), status: p.status,
    title: p.title.slice(0, 120), artist: p.artist.slice(0, 80),
    positionMs: p.positionMs, lengthMs: p.lengthMs, players,
    rate: Math.round(p.rate * 100) / 100, canRate: p.minRate < p.maxRate,
  };
}

/** True when `next` differs from what a board extrapolating `prev` shows. */
export function worthSending(prev: MediaStateMessage | undefined, prevAt: number, next: MediaStateMessage, now: number): boolean {
  if (!prev) return true;
  if (prev.player !== next.player || prev.status !== next.status || prev.title !== next.title
    || prev.artist !== next.artist || prev.lengthMs !== next.lengthMs || prev.players !== next.players
    || prev.rate !== next.rate || prev.canRate !== next.canRate) return true;
  const predicted = prev.positionMs + (prev.status === 'playing' ? (now - prevAt) * prev.rate : 0);
  if (Math.abs(predicted - next.positionMs) > 1500) return true;
  return now - prevAt > 15_000;   // periodic resync against drift
}

/** Browsers: MPRIS says 1x, fixed; the speed comes from the page via the extension. */
const BROWSERS = ['firefox', 'librewolf', 'floorp', 'zen', 'chromium', 'chrome', 'google-chrome', 'brave', 'vivaldi', 'edge'];
export function isBrowserPlayer(instance: string): boolean {
  return BROWSERS.includes(playerLabel(instance).toLowerCase());
}
// Range offered for a page (Firefox mutes audio above 4x).
const PAGE_MIN_RATE = 0.25, PAGE_MAX_RATE = 4;

/** The browser extension bridge (browser-media-bridge.ts), as far as the watcher needs it. */
export interface PageRate {
  rate(): number | undefined;
  setRate(rate: number): boolean;
  media?(): { rate: number; positionMs?: number; lengthMs?: number } | undefined;
  seek?(positionMs: number): boolean;
}

export class MediaWatcher {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private players: MprisPlayer[] = [];
  private shown: MprisPlayer | undefined;
  private pinned: string | undefined;
  private startedAt = new Map<string, number>();
  private last: MediaStateMessage | undefined;
  private lastAt = 0;
  // After a seek, browsers report a stale position (often 0) for a few seconds.
  // Until the player agrees, the expected position wins.
  private seekHold: { instance: string; positionMs: number; at: number; until: number } | undefined;

  constructor(
    private readonly send: (msg: MediaStateMessage) => void,
    private readonly wanted: () => boolean,
    private readonly log: (line: string) => void = () => {},
    private readonly page?: PageRate,
  ) {}

  /** The extension reported (new speed, page left): show it without waiting a poll. */
  pageChanged(): void {
    if (!this.shown || !isBrowserPlayer(this.shown.instance) || this.busy) return;
    this.applyPageRate(this.shown);
    this.publish(false);
  }

  private applyPageRate(p: MprisPlayer): void {
    const rate = this.page?.rate();
    if (rate === undefined) return;
    p.rate = rate;
    p.minRate = PAGE_MIN_RATE;
    p.maxRate = PAGE_MAX_RATE;
    // Firefox's MPRIS reports no length and a near-zero position for pages.
    const m = this.page?.media?.();
    if (m?.lengthMs !== undefined) p.lengthMs = m.lengthMs;
    if (m?.positionMs !== undefined) p.positionMs = m.positionMs;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, 1000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Board (re)attached: send the current state on the next poll. */
  resend(): void {
    this.last = undefined;
  }

  private async poll(): Promise<void> {
    let stdout = '';
    try {
      ({ stdout } = await execFileAsync('playerctl', ['-a', 'metadata', '--format', FORMAT],
        { encoding: 'utf8', timeout: 2_000 }));
    } catch {
      stdout = '';   // "No players found" exits 1; playerctl missing likewise
    }
    const now = Date.now();
    const next = parsePlayers(stdout);
    for (const p of next) {
      const before = this.players.find((x) => x.instance === p.instance);
      if (p.status === 'playing' && before?.status !== 'playing') this.startedAt.set(p.instance, now);
    }
    for (const k of [...this.startedAt.keys()]) if (!next.some((p) => p.instance === k)) this.startedAt.delete(k);
    this.players = next;
    this.shown = choosePlayer(next, this.shown?.instance, this.pinned, this.startedAt);
    // Speed is not in playerctl's metadata: read it off the bus, shown player only.
    if (this.shown) {
      try {
        const { stdout: r } = await execFileAsync('busctl', ['--user', 'get-property', busName(this.shown.instance),
          MPRIS_PATH, MPRIS_PLAYER, 'Rate', 'MinimumRate', 'MaximumRate'], { encoding: 'utf8', timeout: 2_000 });
        Object.assign(this.shown, parseRates(r) ?? {});
      } catch { /* player without Rate: stays 1x, not adjustable */ }
      if (isBrowserPlayer(this.shown.instance)) this.applyPageRate(this.shown);
      this.applySeekHold(this.shown, now);
    }
  }

  private applySeekHold(p: MprisPlayer, now: number): void {
    const h = this.seekHold;
    if (!h) return;
    if (h.instance !== p.instance || now > h.until) { this.seekHold = undefined; return; }
    const expected = h.positionMs + (p.status === 'playing' ? (now - h.at) * p.rate : 0);
    if (Math.abs(p.positionMs - expected) < 1500) { this.seekHold = undefined; return; }
    p.positionMs = Math.round(p.lengthMs ? Math.min(expected, p.lengthMs) : expected);
  }

  /** Where a seek lands, from the position the board was last shown. */
  private holdSeek(p: MprisPlayer, positionMs: number): void {
    const now = Date.now();
    const pos = Math.max(0, p.lengthMs ? Math.min(positionMs, p.lengthMs) : positionMs);
    this.seekHold = { instance: p.instance, positionMs: pos, at: now, until: now + 5000 };
    p.positionMs = Math.round(pos);
    this.publish(true);
  }

  private shownPositionMs(now: number): number {
    const l = this.last;
    if (!l) return this.shown?.positionMs ?? 0;
    return l.positionMs + (l.status === 'playing' ? (now - this.lastAt) * l.rate : 0);
  }

  private async tick(): Promise<void> {
    if (this.busy || !this.wanted()) return;
    this.busy = true;
    try {
      await this.poll();
      this.publish(false);
    } finally {
      this.busy = false;
    }
  }

  private publish(force: boolean): void {
    const now = Date.now();
    const msg = toMessage(this.shown, this.players.length);
    if (!force && !worthSending(this.last, this.lastAt, msg, now)) return;
    this.last = msg;
    this.lastAt = now;
    this.send({ ...msg, localDayMs: localDayMs(new Date(now)) });
  }

  /** A board's media_control. Re-polls right after so the board sees the result. */
  async control(action: MediaAction, value?: number): Promise<void> {
    if (action === 'cycle') {
      if (this.players.length > 1) {
        const i = this.players.findIndex((p) => p.instance === this.shown?.instance);
        this.pinned = this.players[(i + 1) % this.players.length].instance;
        this.shown = this.players.find((p) => p.instance === this.pinned);
      }
      this.publish(true);
      return;
    }
    const target = this.shown?.instance;
    if (!target) return;
    if (action === 'rate') {
      // value: +1 / -1 steps, 0 resets to 1x.
      const p = this.shown!;
      if (p.minRate >= p.maxRate) return;
      const rate = !value ? Math.min(Math.max(1, p.minRate), p.maxRate)
        : stepRate(p.rate, Number(value) > 0 ? 1 : -1, p.minRate, p.maxRate);
      if (isBrowserPlayer(target) && this.page?.rate() !== undefined) {
        if (this.page.setRate(rate)) p.rate = rate;
        this.publish(true);
        return;
      }
      try {
        await execFileAsync('busctl', ['--user', 'set-property', busName(target), MPRIS_PATH, MPRIS_PLAYER,
          'Rate', 'd', String(rate)], { timeout: 2_000 });
      } catch (err) {
        this.log(`[agentdeck] media: set Rate ${rate} on ${target} failed: ${(err as Error).message}`);
      }
      await this.repoll();
      return;
    }
    if ((action === 'seek' || action === 'seek_by') && Number.isFinite(value) && isBrowserPlayer(target)
        && this.page?.media?.()?.positionMs !== undefined) {
      const p = this.shown!;
      const raw = action === 'seek' ? Number(value) : this.shownPositionMs(Date.now()) + Number(value);
      const ms = Math.max(0, p.lengthMs ? Math.min(raw, p.lengthMs) : raw);
      if (this.page.seek?.(ms)) {
        p.positionMs = Math.round(ms);
        this.publish(true);
        return;
      }
    }
    let args: string[];
    if (action === 'toggle') args = ['play-pause'];
    else if (action === 'next') args = ['next'];
    else if (action === 'previous') args = ['previous'];
    else if (action === 'seek' && Number.isFinite(value)) {
      const ms = Math.max(0, Math.min(Number(value), this.shown?.lengthMs || Number(value)));
      args = ['position', (ms / 1000).toFixed(3)];
      this.holdSeek(this.shown!, ms);
    } else if (action === 'seek_by' && Number.isFinite(value) && value) {
      // Absolute, from what the board shows: "+10" on a stale browser position would jump wrong.
      const ms = Math.max(0, this.shownPositionMs(Date.now()) + Number(value));
      args = ['position', (ms / 1000).toFixed(3)];
      this.holdSeek(this.shown!, ms);
    } else return;
    try {
      await execFileAsync('playerctl', ['-p', target, ...args], { timeout: 2_000 });
    } catch (err) {
      this.log(`[agentdeck] media: playerctl ${args.join(' ')} on ${target} failed: ${(err as Error).message}`);
    }
    await this.repoll();
  }

  private async repoll(): Promise<void> {
    // Players apply a change asynchronously; give it a moment, then show it.
    await new Promise((r) => setTimeout(r, 150));
    if (this.busy) return;
    this.busy = true;
    try {
      await this.poll();
      this.publish(true);
    } finally {
      this.busy = false;
    }
  }
}
