/**
 * Answer a plain `claude` session's permission prompt from a device when the
 * session runs in a tmux pane.
 *
 * Claude's permission Notification only says "Claude needs your permission";
 * upstream shows it display-only. A session in tmux can be answered by keys:
 * the dialog opens with "❯ 1. Yes" highlighted, so Enter allows and Escape
 * declines. Before any key, the pane is read back and the highlighted "1. Yes"
 * must be on screen: a prompt answered at the keyboard (or a different dialog)
 * never receives a stray Enter.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseTmuxPanes } from './observed-inject.js';

const execFileAsync = promisify(execFile);
// Short: device requestIds are capped at 39 bytes (prefix + 36-char uuid).
export const TMUX_PERMISSION_PREFIX = 'tp:';

let panes = new Map<string, string>();

/** Re-read which ttys belong to tmux panes (cached for the sync enricher). */
export async function refreshTmuxPanes(): Promise<void> {
  try {
    const { stdout } = await execFileAsync('tmux', ['list-panes', '-a', '-F', '#{pane_tty}\t#{pane_id}'],
      { encoding: 'utf8', timeout: 2_000 });
    panes = parseTmuxPanes(stdout);
  } catch {
    panes = new Map(); // no tmux server
  }
}

/** Synthetic requestId for an awaiting permission row, or undefined when the
 * session is not (as of the last refresh) in a tmux pane. */
export function tmuxPermissionRequestId(uuid: string, tty: string | undefined): string | undefined {
  return tty && panes.has(tty) ? `${TMUX_PERMISSION_PREFIX}${uuid}` : undefined;
}

/** "❯ 1. Yes" as Claude Code renders a fresh permission dialog. */
export function showsPermissionDialog(screen: string): boolean {
  const tail = screen.split('\n').slice(-30).join('\n');
  return /❯\s*1\.\s*Yes\b/.test(tail);
}

export async function answerTmuxPermission(tty: string | undefined, allow: boolean): Promise<{ ok: boolean; reason: string }> {
  await refreshTmuxPanes();
  const pane = tty ? panes.get(tty) : undefined;
  if (!pane) return { ok: false, reason: 'session is not in a tmux pane' };
  let screen: string;
  try {
    ({ stdout: screen } = await execFileAsync('tmux', ['capture-pane', '-p', '-t', pane], { encoding: 'utf8', timeout: 2_000 }));
  } catch {
    return { ok: false, reason: 'tmux capture-pane failed' };
  }
  if (!showsPermissionDialog(screen)) return { ok: false, reason: 'permission dialog no longer on screen' };
  try {
    await execFileAsync('tmux', ['send-keys', '-t', pane, allow ? 'Enter' : 'Escape'], { timeout: 2_000 });
  } catch {
    return { ok: false, reason: 'tmux send-keys failed' };
  }
  return { ok: true, reason: allow ? 'allowed (Enter)' : 'declined (Escape)' };
}
