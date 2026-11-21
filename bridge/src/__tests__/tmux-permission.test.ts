import { describe, expect, it } from 'vitest';
import { showsPermissionDialog, tmuxPermissionRequestId } from '../tmux-permission.js';

describe('tmux permission answering', () => {
  it('recognises a fresh Claude permission dialog', () => {
    const screen = [
      ' Bash command', '   rm -rf build', '', ' Do you want to proceed?',
      ' ❯ 1. Yes', '   2. Yes, and don\'t ask again for rm commands', '   3. No, and tell Claude what to do differently (esc)',
    ].join('\n');
    expect(showsPermissionDialog(screen)).toBe(true);
  });
  it('refuses when the cursor left "1. Yes" or no dialog is shown', () => {
    expect(showsPermissionDialog('   1. Yes\n ❯ 2. No')).toBe(false);
    expect(showsPermissionDialog('> just a prompt\n')).toBe(false);
  });
  it('offers no requestId before a tmux pane is known', () => {
    expect(tmuxPermissionRequestId('abc', 'pts/9')).toBeUndefined();
    expect(tmuxPermissionRequestId('abc', undefined)).toBeUndefined();
  });
});

describe('tmux permission requestId', () => {
  it('fits the compact device requestId cap', async () => {
    const { TMUX_PERMISSION_PREFIX } = await import('../tmux-permission.js');
    const { DEVICE_CONTROLLER_RULES } = await import('@agentdeck/shared');
    expect(TMUX_PERMISSION_PREFIX.length + 36).toBeLessThanOrEqual(DEVICE_CONTROLLER_RULES.compact.requestBytes);
  });
});

describe('tmux permission screen', () => {
  it('ignores the blank rows the TUI leaves below the dialog', async () => {
    const { showsPermissionDialog } = await import('../tmux-permission.js');
    expect(showsPermissionDialog(' Do you want to proceed?\n ❯ 1. Yes\n   4. No\n' + '\n'.repeat(60))).toBe(true);
  });
});
