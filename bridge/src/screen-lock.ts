/**
 * Whether this PC's screen is locked, so a locked PC also locks the boards.
 *
 * Polled once a second from a status command. The default is Noctalia's
 * (`noctalia msg status`, JSON with `"locked": bool`); AGENTDECK_LOCK_STATUS_CMD
 * replaces it (split on spaces, no shell). Its output counts as locked when it
 * is JSON with `locked: true`, or text "1", "true", "yes" or "locked".
 *
 * A command that fails reads as unlocked: on a desktop without the locker the
 * deck keeps working, and the failure is logged once.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_COMMAND = ['noctalia', 'msg', 'status'];

export function parseLockStatus(out: string): boolean {
  const text = out.trim();
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === 'object' && 'locked' in v) return (v as { locked: unknown }).locked === true;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v === 1;
  } catch { /* plain text */ }
  return ['1', 'true', 'yes', 'locked'].includes(text.toLowerCase());
}

export function lockStatusCommand(env: NodeJS.ProcessEnv = process.env): string[] {
  const custom = env.AGENTDECK_LOCK_STATUS_CMD?.trim();
  return custom ? custom.split(/\s+/) : DEFAULT_COMMAND;
}

export class ScreenLockWatcher {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private failing = false;
  locked = false;

  constructor(
    private readonly onChange: (locked: boolean) => void,
    private readonly log: (line: string) => void = () => {},
    private readonly command = lockStatusCommand(),
    private readonly intervalMs = 1000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.poll(); }, this.intervalMs);
    this.timer.unref?.();
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    let locked = false;
    try {
      const { stdout } = await execFileAsync(this.command[0], this.command.slice(1), { encoding: 'utf8', timeout: 2_000 });
      locked = parseLockStatus(stdout);
      if (this.failing) this.log('[agentdeck] screen lock status readable again');
      this.failing = false;
    } catch (err) {
      if (!this.failing) {
        this.log(`[agentdeck] screen lock status (${this.command.join(' ')}) unavailable, deck stays unlocked: ${(err as Error).message.split('\n')[0]}`);
      }
      this.failing = true;
    } finally {
      this.busy = false;
    }
    if (locked !== this.locked) {
      this.locked = locked;
      this.onChange(locked);
    }
  }
}

/** Board commands that act on agents, media or settings: refused while the PC is locked. */
export const LOCKED_REFUSED_COMMANDS = new Set([
  'escape', 'interrupt', 'respond', 'select_option', 'send_prompt', 'permission_decision',
  'session_command', 'set_session_setting', 'switch_agent', 'voice', 'review_run',
  'media_control', 'focus_session', 'clear_session_focus', 'device_security_restore',
]);
