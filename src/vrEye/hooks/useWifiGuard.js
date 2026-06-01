/**
 * useWifiGuard.js
 *
 * React hook that:
 *   1. Polls & subscribes to network connectivity (NetInfo)
 *   2. Dispatches to Redux wifi slice on every change
 *   3. Exposes helpers for components:
 *        isConnected   — bool
 *        isWifi        — bool (true when type is 'wifi')
 *        ipAddress     — string | null
 *        initialized   — bool (first check done)
 *
 * Used by WifiGuard component and screens directly.
 *
 * Install:
 *   npm install @react-native-community/netinfo react-native-network-info
 */

import { useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import NetInfo from '@react-native-community/netinfo';
import { setWifiState, wifiLost, wifiRestored, setIpAddress, selectWifi } from '../../store/slices/wifiSlice';
// import { setWifiState, wifiLost, wifiRestored, setIpAddress, selectWifi } from '../store/wifiSlice';

// Safe import of NetworkInfo for IP resolution
let NetworkInfo = null;
try { NetworkInfo = require('react-native-network-info').NetworkInfo; } catch {}

async function resolveIp() {
  try {
    return (
      await NetworkInfo?.getIPV4Address?.() ??
      await NetworkInfo?.getIPAddress?.()   ??
      null
    );
  } catch {
    return null;
  }
}

export function useWifiGuard() {
  const dispatch = useDispatch();
  const wifi     = useSelector(selectWifi);

  const applyNetState = useCallback(async (state) => {
    const connected = state.isConnected === true && state.isInternetReachable !== false;
    const type      = state.type ?? 'unknown'; // 'wifi' | 'cellular' | 'none' | 'unknown'

    if (!connected) {
      dispatch(wifiLost());
      return;
    }

    const ip = await resolveIp();

    dispatch(wifiRestored({
      ssid:      state.details?.ssid   ?? null,
      ipAddress: ip,
    }));

    dispatch(setWifiState({
      isConnected:    true,
      isWifiEnabled:  type === 'wifi',
      connectionType: type,
      ssid:           state.details?.ssid ?? null,
      ipAddress:      ip,
    }));
  }, [dispatch]);

  useEffect(() => {
    // Initial fetch
    NetInfo.fetch().then(applyNetState);

    // Subscribe to changes
    const unsub = NetInfo.addEventListener(applyNetState);

    // Refresh IP every 30 s in case DHCP renewed
    const ipTimer = setInterval(async () => {
      const ip = await resolveIp();
      if (ip) dispatch(setIpAddress(ip));
    }, 30_000);

    return () => {
      unsub();
      clearInterval(ipTimer);
    };
  }, [applyNetState, dispatch]);

  return {
    isConnected: wifi.isConnected,
    isWifi:      wifi.connectionType === 'wifi',
    ipAddress:   wifi.ipAddress,
    ssid:        wifi.ssid,
    initialized: wifi.initialized,
    wifi,
  };
}
