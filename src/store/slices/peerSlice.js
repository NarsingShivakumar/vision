/**
 * store/slices/peerSlice.js
 *
 * Single source of truth for the local TCP peer connection between
 * VR Host (PatientScreen) and Controller (ControllerScreen).
 *
 * State is driven exclusively by localPeerService events via the
 * usePeerSync hook — no component should call setPeerState directly.
 */

import { createSlice } from '@reduxjs/toolkit';

// ─── Initial state ─────────────────────────────────────────────────────────────
const initialState = {
  role: null,                // 'host' | 'controller' | null
  phase: 'idle',             // 'idle' | 'starting' | 'listening' | 'connecting'
                             //  | 'connected' | 'reconnecting' | 'failed' | 'destroyed'
  connected: false,
  peerAddress: null,         // IP of remote peer
  rtt: null,                 // last ping RTT ms
  reconnectAttempt: 0,
  reconnectFailed: false,
  failedAttempts: 0,
  serverReady: false,        // HOST: TCP server is bound and listening
  error: null,
};

const peerSlice = createSlice({
  name: 'peer',
  initialState,
  reducers: {
    setRole(state, { payload }) {
      state.role = payload;
    },
    serverStarting(state) {
      state.phase = 'starting';
      state.error = null;
    },
    serverReady(state) {
      state.phase = 'listening';
      state.serverReady = true;
      state.error = null;
    },
    connecting(state) {
      state.phase = 'connecting';
      state.error = null;
      state.reconnectFailed = false;
    },
    connected(state, { payload = {} }) {
      state.phase = 'connected';
      state.connected = true;
      state.peerAddress = payload.address ?? null;
      state.error = null;
      state.reconnectAttempt = 0;
      state.reconnectFailed = false;
      state.failedAttempts = 0;
    },
    disconnected(state) {
      state.connected = false;
      state.rtt = null;
      state.peerAddress = null;
      // Keep phase as-is — scheduleReconnect will update to 'reconnecting'
    },
    reconnecting(state, { payload = {} }) {
      state.phase = 'reconnecting';
      state.connected = false;
      state.reconnectAttempt = payload.attempt ?? state.reconnectAttempt + 1;
      state.reconnectFailed = false;
      state.error = null;
    },
    reconnectFailed(state, { payload = {} }) {
      state.phase = 'failed';
      state.reconnectFailed = true;
      state.failedAttempts = payload.attempts ?? state.reconnectAttempt;
      state.error = `Connection lost after ${state.failedAttempts} attempts`;
    },
    peerTimeout(state) {
      state.connected = false;
      state.rtt = null;
      state.error = 'Peer timed out';
    },
    rttUpdated(state, { payload }) {
      state.rtt = payload;
    },
    peerError(state, { payload }) {
      state.error = payload;
    },
    resetReconnect(state) {
      state.reconnectFailed = false;
      state.reconnectAttempt = 0;
      state.error = null;
      state.phase = 'connecting';
    },
    destroyed(state) {
      return { ...initialState, role: state.role };
    },
  },
});

export const peerActions = peerSlice.actions;
export default peerSlice.reducer;

// ─── Selectors ─────────────────────────────────────────────────────────────────
export const selectPeer            = (s) => s.peer;
export const selectPeerConnected   = (s) => s.peer.connected;
export const selectPeerPhase       = (s) => s.peer.phase;
export const selectPeerRole        = (s) => s.peer.role;
export const selectPeerRtt         = (s) => s.peer.rtt;
export const selectPeerReconnecting= (s) => s.peer.phase === 'reconnecting';
export const selectPeerFailed      = (s) => s.peer.reconnectFailed;
export const selectServerReady     = (s) => s.peer.serverReady;
