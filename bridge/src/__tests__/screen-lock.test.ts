import { describe, expect, it } from 'vitest';
import { LOCKED_REFUSED_COMMANDS, lockStatusCommand, parseLockStatus, ScreenLockWatcher } from '../screen-lock.js';

describe('screen lock', () => {
  it('reads Noctalia status and plain text', () => {
    expect(parseLockStatus('{"barVisible":true,"locked":true}')).toBe(true);
    expect(parseLockStatus('{"locked":false}')).toBe(false);
    expect(parseLockStatus('{}')).toBe(false);
    expect(parseLockStatus('true\n')).toBe(true);
    expect(parseLockStatus('LockedHint=yes')).toBe(false);
    expect(parseLockStatus('yes')).toBe(true);
    expect(parseLockStatus('1')).toBe(true);
    expect(parseLockStatus('0')).toBe(false);
  });

  it('takes the command from the environment', () => {
    expect(lockStatusCommand({})).toEqual(['noctalia', 'msg', 'status']);
    expect(lockStatusCommand({ AGENTDECK_LOCK_STATUS_CMD: ' my-lock  --status ' })).toEqual(['my-lock', '--status']);
  });

  it('reports changes and reads a failing command as unlocked', async () => {
    const changes: boolean[] = [];
    const logs: string[] = [];
    const locked = new ScreenLockWatcher((l) => changes.push(l), (l) => logs.push(l), ['echo', '{"locked":true}']);
    await locked.poll();
    await locked.poll();
    expect(locked.locked).toBe(true);
    expect(changes).toEqual([true]);
    const missing = new ScreenLockWatcher((l) => changes.push(l), (l) => logs.push(l), ['/nonexistent/lock-status']);
    await missing.poll();
    await missing.poll();
    expect(missing.locked).toBe(false);
    expect(logs.filter((l) => l.includes('unavailable'))).toHaveLength(1);
  });

  it('refuses the acting commands only', () => {
    for (const t of ['permission_decision', 'send_prompt', 'voice', 'media_control']) expect(LOCKED_REFUSED_COMMANDS.has(t)).toBe(true);
    for (const t of ['query_usage', 'daemon_checkpoint_ack', 'query_session_settings']) expect(LOCKED_REFUSED_COMMANDS.has(t)).toBe(false);
  });
});
