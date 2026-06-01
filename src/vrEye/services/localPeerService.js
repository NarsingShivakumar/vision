/**
 * localPeerService.js v1.1 — Reconnection Update
 *
 * Changes from v1.0:
 * - ADD: manualReconnect() — CONTROLLER: resets back-off counter and retries immediately
 * - ADD: ensureServerAlive() — HOST: guarantees TCP server stays open across nav screens
 * - HOST pong-timeout path already kept server alive; ensureServerAlive() is a safety net
 *   for PatientScreen mount when the server reference may have been replaced.
 */

import TcpSocket from 'react-native-tcp-socket';

// ─── Constants ────────────────────────────────────────────────────────────────
const PING_INTERVAL = 3000;   // ms between host pings
const PONG_TIMEOUT = 8000;   // ms before host marks peer dead
const RECONNECT_BASE = 1500;   // ms base reconnect delay (controller)
const RECONNECT_MAX = 16000;  // ms max reconnect delay
const MAX_RECONNECT = 20;     // give up after N attempts  (0 = infinite)
const TCP_PORT = 54321;  // default port — must be open on host device

// ─── Roles ────────────────────────────────────────────────────────────────────
export const PEER_ROLE = {
  HOST: 'host',
  CONTROLLER: 'controller',
};

// ─── Service ──────────────────────────────────────────────────────────────────
class LocalPeerService {
  constructor() {
    this.role = null;
    this.server = null;   // TcpSocket.Server (host only)
    this.socket = null;   // active connection socket
    this.hostIp = null;
    this.port = TCP_PORT;
    this.listeners = {};     // event → Set<fn>
    this.pingTimer = null;
    this.pongTimer = null;
    this.reconnectTimer = null;
    this.reconnectCount = 0;
    this.reconnectDelay = RECONNECT_BASE;
    this.connected = false;
    this.destroyed = false;
    this.rtt = null;   // last measured round-trip ms
    this.readBuffer = '';     // partial message buffer
    this.lastConnectionMeta = {
      hostIp: null,
      port: TCP_PORT,
      role: null,
    };
    this.serverStartedOnce = false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════════

  /** Start as HOST — opens a TCP server on given port */
  startServer(port = TCP_PORT) {
    if (this.server) return;
    this.role = PEER_ROLE.HOST;
    this.port = port;
    this.destroyed = false;
    this.lastConnectionMeta = {
      hostIp: null,
      port,
      role: PEER_ROLE.HOST,
    };
    this.serverStartedOnce = true;

    this.server = TcpSocket.createServer((socket) => {
      console.log('[LocalPeer] Controller connected from', socket.remoteAddress);
      this.attachSocket(socket);
      this.connected = true;
      this.startPingLoop();
      this.emit('connected', { role: PEER_ROLE.CONTROLLER, address: socket.remoteAddress });
    });

    this.server.listen(port, '0.0.0.0');

    this.server.on('error', (err) => {
      console.error('[LocalPeer] Server error:', err.message);
      this.emit('error', { message: err.message });
    });

    console.log(`[LocalPeer] Server listening on port ${port}`);
    this.emit('serverready', { port });
  }

  /**
   * HOST only — called by PatientScreen on mount to guarantee the TCP server
   * stays open and listening so a reconnecting controller can re-attach.
   * Safe to call multiple times; no-ops when server is already running.
   */
  ensureServerAlive(port = TCP_PORT) {
    if (this.role !== PEER_ROLE.HOST) return;
    if (this.server) return; // already running
    console.log('[LocalPeer] ensureServerAlive — restarting server');
    this.startServer(port);
  }

  restartServerIfNeeded() {
    if (this.role !== PEER_ROLE.HOST) return;
    if (this.server) return;
    this.startServer(this.port || TCP_PORT);
  }

  retryLastConnection() {
    if (this.lastConnectionMeta.role === PEER_ROLE.CONTROLLER && this.lastConnectionMeta.hostIp) {
      this.destroyed = false;
      this.hostIp = this.lastConnectionMeta.hostIp;
      this.port = this.lastConnectionMeta.port || TCP_PORT;
      this.manualReconnect();
    } else if (this.lastConnectionMeta.role === PEER_ROLE.HOST) {
      this.destroyed = false;
      this.restartServerIfNeeded();
    }
  }

  getConnectionSnapshot() {
    return {
      role: this.role,
      hostIp: this.hostIp,
      port: this.port,
      connected: this.connected,
      reconnectCount: this.reconnectCount,
      reconnectDelay: this.reconnectDelay,
    };
  }

  /** Connect as CONTROLLER to host IP:port */
  connectToHost(ip, port = TCP_PORT) {
    this.role = PEER_ROLE.CONTROLLER;
    this.hostIp = ip;
    this.port = port;
    this.destroyed = false;
    this.lastConnectionMeta = {
      hostIp: ip,
      port,
      role: PEER_ROLE.CONTROLLER,
    };
    this.doConnect();
  }

  /**
   * CONTROLLER only — manually restart the reconnect cycle.
   * Resets the back-off counter so the next attempt starts fresh immediately.
   * Safe to call at any time; ignored if already connected or not a controller.
   */
  manualReconnect() {
    if (this.role !== PEER_ROLE.CONTROLLER) return;
    if (this.connected) return;

    // Cancel any pending timer so scheduleReconnect doesn't double-fire
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Reset back-off state
    this.reconnectCount = 0;
    this.reconnectDelay = RECONNECT_BASE;
    this.destroyed = false;

    console.log('[LocalPeer] manualReconnect — resetting and reconnecting now');
    this.emit('reconnecting', { attempt: 0, delay: 0 });
    this.doConnect();
  }

  /** Send an event to the peer */
  send(type, payload) {
    if (!this.socket || !this.connected) {
      console.warn('[LocalPeer] Cannot send — not connected:', type);
      return false;
    }
    const msg = JSON.stringify({ type, payload, ts: Date.now() }) + '\n';
    try {
      this.socket.write(msg);
      return true;
    } catch (e) {
      console.warn('[LocalPeer] Send error:', e.message);
      return false;
    }
  }

  /** Subscribe to an event. Returns unsubscribe fn. */
  on(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = new Set();
    this.listeners[event].add(handler);
    return () => this.listeners[event]?.delete(handler);
  }

  /** Whether a peer is currently connected */
  isConnected() { return this.connected; }

  /** Last measured ping RTT in ms, null if unknown */
  getRTT() { return this.rtt; }

  /** Current role */
  getRole() { return this.role; }

  /** Full teardown */
  destroy() {
    this.destroyed = true;
    this.clearTimers();
    this.socket?.destroy();
    this.server?.close();
    this.socket = null;
    this.server = null;
    this.connected = false;
    this.listeners = {};
    console.log('[LocalPeer] Destroyed');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Internal
  // ═══════════════════════════════════════════════════════════════════════════

  doConnect() {
    if (this.destroyed) return;
    const opts = { port: this.port, host: this.hostIp, tls: false };
    const socket = TcpSocket.createConnection(opts, () => {
      console.log('[LocalPeer] Connected to host', this.hostIp);
      this.reconnectCount = 0;
      this.reconnectDelay = RECONNECT_BASE;
      this.connected = true;
      this.emit('connected', { role: PEER_ROLE.HOST, address: this.hostIp });
      this.attachSocket(socket);
    });
  }

  attachSocket(socket) {
    // Destroy previous socket cleanly
    if (this.socket && this.socket !== socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
    }
    this.socket = socket;
    this.readBuffer = '';

    socket.setEncoding('utf8');
    socket.setNoDelay(true);

    socket.on('data', (data) => this.onData(data));

    socket.on('error', (err) => {
      console.warn('[LocalPeer] Socket error:', err.message);
      this.emit('error', { message: err.message });
    });

    socket.on('close', () => {
      console.log('[LocalPeer] Socket closed');
      this.connected = false;
      this.clearPingLoop();
      this.emit('disconnected', {});

      if (this.role === PEER_ROLE.HOST) {
        this.restartServerIfNeeded();
      }

      if (this.role === PEER_ROLE.CONTROLLER && !this.destroyed) {
        this.scheduleReconnect();
      }
    });
  }

  onData(chunk) {
    this.readBuffer += chunk;
    // Messages are newline-delimited
    const lines = this.readBuffer.split('\n');
    this.readBuffer = lines.pop(); // last may be partial
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        this.handleMessage(msg);
      } catch (e) {
        console.warn('[LocalPeer] Parse error:', e.message, '| raw:', line.slice(0, 80));
      }
    }
  }

  handleMessage(msg) {
    const { type, payload, ts } = msg;

    if (type === 'ping') {
      // Controller replies with pong immediately
      this.send('pong', ts);
      return;
    }

    if (type === 'pong') {
      // Host receives pong — measure RTT and reset watchdog
      this.rtt = Date.now() - ts;
      this.resetPongWatchdog();
      this.emit('pingrtt', { rtt: this.rtt });
      return;
    }

    // All other messages forwarded to app listeners
    this.emit(type, payload ?? {});
    // Also emit generic 'message' event
    this.emit('message', { type, payload, ts });
  }

  // ── Ping loop (host only) ──────────────────────────────────────────────────

  startPingLoop() {
    this.clearPingLoop();
    this.pingTimer = setInterval(() => {
      if (!this.connected) return;
      this.send('ping', { ts: Date.now() });
      this.armPongWatchdog();
    }, PING_INTERVAL);
  }

  armPongWatchdog() {
    if (this.pongTimer) return; // already armed
    this.pongTimer = setTimeout(() => {
      console.warn('[LocalPeer] Pong timeout — peer unresponsive');
      this.pongTimer = null;
      this.emit('peertimeout', {});
      // Host tries to accept a fresh connection — close stale socket
      this.socket?.destroy();
      this.connected = false;
    }, PONG_TIMEOUT);
  }

  resetPongWatchdog() {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  clearPingLoop() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.resetPongWatchdog();
  }

  // ── Reconnection (controller only) ────────────────────────────────────────

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (MAX_RECONNECT > 0 && this.reconnectCount >= MAX_RECONNECT) {
      console.warn('[LocalPeer] Max reconnect attempts reached');
      this.emit('reconnectfailed', { attempts: this.reconnectCount });
      return;
    }

    this.reconnectCount++;
    const delay = Math.min(this.reconnectDelay, RECONNECT_MAX);
    this.reconnectDelay = Math.min(delay * 1.5, RECONNECT_MAX);

    console.log(`[LocalPeer] Reconnect attempt ${this.reconnectCount} in ${delay}ms`);
    this.emit('reconnecting', { attempt: this.reconnectCount, delay });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.destroyed) this.doConnect();
    }, delay);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  clearTimers() {
    this.clearPingLoop();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  emit(event, data) {
    (this.listeners[event] ?? new Set()).forEach((fn) => {
      try { fn(data); } catch (e) {
        console.warn('[LocalPeer] listener error:', event, e);
      }
    });
  }
}

export default new LocalPeerService();