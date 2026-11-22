/**
 * Playback speed of web pages (YouTube, Jellyfin web, Spotify web …).
 *
 * Browsers publish their media over MPRIS but refuse to have the Rate set from
 * outside (Firefox reports a fixed 1x). The "Motorized Faders media speed"
 * Firefox extension (github.com/Ilosariph/motorized-faders, browser/) sets it
 * from inside the page; from 0.2.0 it connects to every host it knows, this
 * daemon on 127.0.0.1:47392 among them:
 *
 *   extension -> host   {"type":"state","rate":1.5|null,"playing":true,"title":"..."}
 *   host -> extension   {"type":"set_rate","rate":1.5}
 *
 * Loopback only, and only extension origins: web pages can open WebSockets to
 * localhost too.
 */
import { WebSocketServer, type WebSocket } from 'ws';

export const BROWSER_BRIDGE_PORT = 47392;
const ORIGINS = ['moz-extension://', 'chrome-extension://'];

interface Client {
  ws: WebSocket;
  rate: number | null;
  playing: boolean;
  title: string;
  updated: number;
}

export function isExtensionOrigin(origin: string | undefined): boolean {
  return !!origin && ORIGINS.some((o) => origin.startsWith(o));
}

export class BrowserMediaBridge {
  private server: WebSocketServer | null = null;
  private clients = new Set<Client>();

  constructor(
    private readonly onChange: () => void = () => {},
    private readonly log: (line: string) => void = () => {},
    private readonly port = BROWSER_BRIDGE_PORT,
  ) {}

  start(): void {
    if (this.server) return;
    const server = new WebSocketServer({
      host: '127.0.0.1', port: this.port, maxPayload: 65536,
      verifyClient: (info: { origin?: string }) => isExtensionOrigin(info.origin),
    });
    server.on('error', (err) => {
      this.log(`[agentdeck] browser media bridge: cannot listen on 127.0.0.1:${this.port}: ${err.message}`);
      this.server = null;
    });
    server.on('listening', () => this.log(`[agentdeck] browser media bridge on ws://127.0.0.1:${this.port}`));
    server.on('connection', (ws) => {
      const client: Client = { ws, rate: null, playing: false, title: '', updated: Date.now() };
      this.clients.add(client);
      ws.on('message', (data) => {
        let msg: { type?: unknown; rate?: unknown; playing?: unknown; title?: unknown };
        try { msg = JSON.parse(String(data)); } catch { return; }
        if (msg.type !== 'state') return;
        client.rate = typeof msg.rate === 'number' && msg.rate > 0 ? msg.rate : null;
        client.playing = msg.playing === true;
        client.title = typeof msg.title === 'string' ? msg.title : '';
        client.updated = Date.now();
        this.onChange();
      });
      ws.on('close', () => { this.clients.delete(client); this.onChange(); });
      ws.on('error', () => {});
    });
    this.server = server;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    for (const c of this.clients) c.ws.terminate();
    this.clients.clear();
  }

  /** The page the speed acts on: playing first, most recently changed first. */
  private current(): Client | undefined {
    let best: Client | undefined;
    for (const c of this.clients) {
      if (c.rate === null) continue;
      if (!best || (c.playing && !best.playing) || (c.playing === best.playing && c.updated > best.updated)) best = c;
    }
    return best;
  }

  /** Speed of the current page's media; undefined without one. */
  rate(): number | undefined {
    return this.current()?.rate ?? undefined;
  }

  setRate(rate: number): boolean {
    const c = this.current();
    if (!c) return false;
    try {
      c.ws.send(JSON.stringify({ type: 'set_rate', rate: Math.round(rate * 1000) / 1000 }));
    } catch {
      return false;
    }
    c.rate = rate;   // shown right away; the page confirms with its own report
    return true;
  }
}
