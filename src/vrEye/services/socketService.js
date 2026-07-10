// services/socketService.js  v1.2
// v1.2: added 'assistant_disconnected' and 'result_ready' to VR_EVENTS
import { io } from 'socket.io-client';
import { socketURI } from '../../assets/constants';

const VR_EVENTS = [
  'session_created',
  'session_joined',
  'session_error',
  'patient_ready',
  'patient_disconnected',
  'patient_status_update',
  'show_optotype',
  'show_instruction',
  'show_color_plate',
  'show_color_eye',
  'show_near_eye',
  'response_recorded',
  'phase_changed',
  'test_complete',
  'peer_disconnected',
  'vr_offer',
  'vr_answer',
  'vr_candidate',
  'webrtc_patient_ready',
  'webrtc_ping',
  'mute_patient',
  'session_closed',
  'session_ended',
  'vr_show_near_line',
  'show_near_line',
  'lens_check',
  'session_assigned',
  'assistant_joined',
  // ── v1.2 additions ──────────────────────────────────────────────────────
  'assistant_disconnected', // fires when the assistant's socket drops mid-session
  'result_ready',           // fires when the vision report PDF is ready; payload: { resultId }
  'call_declined',
];

class SocketService {
  constructor() {
    this.socket = null;
    this.listeners = {};
    this.anyListeners = [];
  }

  // ─── Connection ────────────────────────────────────────────────────────────

  /**
   * Connect socket and register role.
   * Mirrors Angular SocketService.connect(role, assistantId).
   *
   * @param {'patient' | 'assistant'} role
   * @param {string} [assistantId]
   */
  connect(role = 'patient', assistantId) {
    if (this.socket?.connected) return;

    this.socket = io(socketURI, {
      transports: ['websocket', 'polling'],
      forceNew: true,
    });

    this.socket.on('connect', () => {
      console.log(`[Socket] Connected as ${role} | id=${this.socket.id}`);

      const payload = { role };
      if (assistantId) payload.assistantId = assistantId;

      console.log('[Socket Emit] register_role', JSON.stringify(payload));
      this.socket.emit('register_role', payload);
      this._emitLocal('connect');
    });

    this.socket.on('disconnect', reason => {
      console.log('[Socket] Disconnected:', reason);
      this._emitLocal('disconnect', reason);
    });

    VR_EVENTS.forEach(event => {
      this.socket.on(event, data => {
        console.log(`[Socket Received] ${event}`, data ? JSON.stringify(data) : 'No payload');
        this._emitLocal(event, data);
      });
    });
  }

  // ─── Internal broadcast ────────────────────────────────────────────────────

  _emitLocal(event, data) {
    const handlers = this.listeners[event] || [];
    handlers.forEach(fn => {
      try {
        fn(data);
      } catch (e) {
        console.warn(`[Socket] listener error for "${event}"`, e);
      }
    });
  }

  // ─── Subscription ──────────────────────────────────────────────────────────

  /**
   * Subscribe to a socket event.
   * Mirrors Angular SocketService.on(eventName): Observable<any>
   *
   * @param {string} eventName
   * @param {Function} callback
   * @returns {Function} unsubscribe function
   */
  on(eventName, callback) {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }
    this.listeners[eventName].push(callback);

    // Return unsubscribe function (mirrors RxJS Subscription.unsubscribe)
    return () => {
      this.listeners[eventName] = (this.listeners[eventName] || []).filter(
        fn => fn !== callback,
      );
    };
  }

  /**
   * Run callback once socket is connected (or immediately if already connected).
   * Mirrors Angular SocketService.onConnected(): Observable<void>
   *
   * @param {Function} callback
   * @returns {Function} unsubscribe function
   */
  onConnected(callback) {
    if (this.socket?.connected) {
      callback();
      return () => { };
    }
    return this.on('connect', callback);
  }

  // ─── Emit ──────────────────────────────────────────────────────────────────

  /**
   * Emit an event to the server.
   * Mirrors Angular SocketService.emit(event, data)
   *
   * @param {string} event
   * @param {any} data
   */
  emit(event, data) {
    if (this.socket?.connected) {
      console.log(`[Socket Emit] ${event}`, data ? JSON.stringify(data) : 'No payload');
      this.socket.emit(event, data);
    } else {
      console.warn('[Socket] Not connected — cannot emit', event);
    }
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  /**
   * Check connection status.
   * Mirrors Angular SocketService.isConnected(): boolean
   */
  isConnected() {
    return this.socket?.connected ?? false;
  }

  // ─── Disconnect ────────────────────────────────────────────────────────────

  /**
   * Fully disconnect and clean up all listeners.
   * Mirrors Angular SocketService.disconnect()
   */
  disconnect() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.listeners = {};
  }
}

// Singleton export — mirrors Angular's providedIn: 'root'
export default new SocketService();