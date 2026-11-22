import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { BrowserMediaBridge, isExtensionOrigin } from '../browser-media-bridge.js';
import { isBrowserPlayer } from '../media-mpris.js';

const PORT = 47399;
const open = (origin: string) => new Promise<WebSocket>((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin });
  ws.once('open', () => resolve(ws));
  ws.once('error', reject);
});
const tick = () => new Promise((r) => setTimeout(r, 50));

describe('browser media bridge', () => {
  it('admits extension origins only', () => {
    expect(isExtensionOrigin('moz-extension://abc')).toBe(true);
    expect(isExtensionOrigin('https://youtube.com')).toBe(false);
    expect(isExtensionOrigin(undefined)).toBe(false);
    expect(isBrowserPlayer('firefox.instance_1_42')).toBe(true);
    expect(isBrowserPlayer('plezy')).toBe(false);
  });

  it('reads the playing page speed and sets it', async () => {
    let changes = 0;
    const bridge = new BrowserMediaBridge(() => { changes++; }, () => {}, PORT);
    bridge.start();
    await tick();
    try {
      await expect(open('https://evil.example')).rejects.toThrow();
      const ws = await open('moz-extension://x');
      const got: unknown[] = [];
      ws.on('message', (d) => got.push(JSON.parse(String(d))));
      ws.send(JSON.stringify({ type: 'state', rate: 1.5, playing: true, title: 'v' }));
      await tick();
      expect(changes).toBeGreaterThan(0);
      expect(bridge.rate()).toBe(1.5);
      expect(bridge.setRate(2)).toBe(true);
      await tick();
      expect(got).toEqual([{ type: 'set_rate', rate: 2 }]);
      expect(bridge.rate()).toBe(2);
      ws.send(JSON.stringify({ type: 'state', rate: null, playing: false, title: '' }));
      await tick();
      expect(bridge.rate()).toBeUndefined();
      ws.close();
    } finally {
      bridge.stop();
    }
  });
});
