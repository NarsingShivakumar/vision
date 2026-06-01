/**
 * store/slices/wifiSlice.js
 *
 * Single source of truth for Wi-Fi / network connectivity.
 * Driven by useWifiGuard hook via NetInfo.
 */

import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  isConnected: true,          // optimistic until first check
  isWifiEnabled: false,
  connectionType: 'unknown',  // 'wifi' | 'cellular' | 'none' | 'unknown'
  ssid: null,
  ipAddress: null,
  initialized: false,         // false until first NetInfo.fetch() returns
  lostAt: null,               // timestamp when connection dropped
  restoredAt: null,
};

const wifiSlice = createSlice({
  name: 'wifi',
  initialState,
  reducers: {
    setWifiState(state, { payload }) {
      Object.assign(state, payload);
      if (!state.initialized) state.initialized = true;
    },
    wifiLost(state) {
      state.isConnected = false;
      state.lostAt = Date.now();
      state.initialized = true;
    },
    wifiRestored(state, { payload = {} }) {
      state.isConnected = true;
      state.restoredAt = Date.now();
      state.ssid = payload.ssid ?? state.ssid;
      state.ipAddress = payload.ipAddress ?? state.ipAddress;
      state.initialized = true;
    },
    setIpAddress(state, { payload }) {
      state.ipAddress = payload;
    },
  },
});

export const { setWifiState, wifiLost, wifiRestored, setIpAddress } = wifiSlice.actions;
export default wifiSlice.reducer;

// ─── Selectors ─────────────────────────────────────────────────────────────────
export const selectWifi          = (s) => s.wifi;
export const selectIsConnected   = (s) => s.wifi.isConnected;
export const selectIpAddress     = (s) => s.wifi.ipAddress;
export const selectWifiInitialized = (s) => s.wifi.initialized;
