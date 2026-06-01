/**
 * useLocalPeer.js v1.1 — Reconnection Update
 *
 * Changes from v1.0:
 * - ADD: `reconnectFailed` and `failedAttempts` in status
 * - ADD: `manualReconnect` function exposed from hook
 * - FIX: `reconnectFailed` cleared on successful re-connection
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import localPeerService, { PEER_ROLE } from './localPeerService';

export function useLocalPeer() {
  const [status, setStatus] = useState({
    connected: false,
    connecting: false,
    reconnecting: false,
    reconnectAttempt: 0,
    reconnectFailed: false,   // NEW: true when auto back-off exhausted
    failedAttempts: 0,       // NEW: how many attempts were made
    rtt: null,
    error: null,
    peerAddress: null,
    serverReady: false,
  });

  const unsubs = useRef([]);

  const updateStatus = useCallback((patch) => {
    setStatus((prev) => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    const U = unsubs.current;

    U.push(localPeerService.on('serverready', () =>
      updateStatus({ serverReady: true, connecting: false, error: null })
    ));

    U.push(localPeerService.on('connected', ({ address }) =>
      updateStatus({
        connected: true,
        connecting: false,
        reconnecting: false,
        reconnectAttempt: 0,
        reconnectFailed: false,  // clear on successful connect
        failedAttempts: 0,
        peerAddress: address,
        error: null,
      })
    ));

    U.push(localPeerService.on('disconnected', () =>
      updateStatus({ connected: false, rtt: null, peerAddress: null })
    ));

    U.push(localPeerService.on('reconnecting', ({ attempt, delay }) =>
      updateStatus({
        reconnecting: true,
        connecting: true,
        reconnectAttempt: attempt,
        connected: false,
        reconnectFailed: false,
      })
    ));

    // NEW: wire reconnectfailed
    U.push(localPeerService.on('reconnectfailed', ({ attempts }) =>
      updateStatus({
        reconnecting: false,
        connecting: false,
        reconnectFailed: true,
        failedAttempts: attempts,
        error: `Failed to reconnect after ${attempts} attempts`,
      })
    ));

    U.push(localPeerService.on('pingrtt', ({ rtt }) =>
      updateStatus({ rtt })
    ));

    U.push(localPeerService.on('peertimeout', () =>
      updateStatus({ connected: false, error: 'Peer timed out', rtt: null })
    ));

    U.push(localPeerService.on('error', ({ message }) =>
      updateStatus({ error: message })
    ));

    return () => { U.forEach((fn) => fn()); };
  }, [updateStatus]);

  // ── Actions ────────────────────────────────────────────────────────────────

  /** HOST: start TCP server */
  const startServer = useCallback((port) => {
    updateStatus({ connecting: true, serverReady: false });
    localPeerService.startServer(port);
  }, [updateStatus]);

  /** CONTROLLER: connect to host */
  const connect = useCallback((ip, port) => {
    updateStatus({ connecting: true, error: null });
    localPeerService.connectToHost(ip, port);
  }, [updateStatus]);

  /**
   * CONTROLLER: manually retry after reconnectFailed.
   * Resets status and calls service.manualReconnect().
   */
  const manualReconnect = useCallback(() => {
    updateStatus({
      reconnectFailed: false,
      reconnecting: true,
      connecting: true,
      error: null,
    });
    localPeerService.manualReconnect();
  }, [updateStatus]);

  const retryLastConnection = useCallback(() => {
    updateStatus({
      reconnectFailed: false,
      reconnecting: true,
      connecting: true,
      error: null,
    });
    localPeerService.retryLastConnection();
  }, [updateStatus]);

  /** Send a typed event to peer */
  const send = useCallback((type, payload) =>
    localPeerService.send(type, payload), []);

  /** Subscribe to peer event. Returns unsub fn. */
  const on = useCallback((event, handler) =>
    localPeerService.on(event, handler), []);

  /** Full teardown */
  const destroy = useCallback(() => {
    localPeerService.destroy();
    setStatus({
      connected: false, connecting: false, reconnecting: false,
      reconnectAttempt: 0, reconnectFailed: false, failedAttempts: 0,
      rtt: null, error: null, peerAddress: null, serverReady: false,
    });
  }, []);

  return { status, startServer, connect, send, on, destroy, manualReconnect, retryLastConnection };
}