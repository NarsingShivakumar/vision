// services/kioskMode.js
import { NativeModules, Platform } from 'react-native';

const { KioskMode } = NativeModules;

export function startKioskMode() {
  if (Platform.OS !== 'android' || !KioskMode) return;
  try { KioskMode.startKioskMode(); } catch (e) { console.warn('[KioskMode] start failed:', e?.message); }
}

export function stopKioskMode() {
  if (Platform.OS !== 'android' || !KioskMode) return;
  try { KioskMode.stopKioskMode(); } catch (e) { console.warn('[KioskMode] stop failed:', e?.message); }
}

export function isKioskModeEnabled() {
  return new Promise((resolve) => {
    if (Platform.OS !== 'android' || !KioskMode) { resolve(false); return; }
    try { KioskMode.isKioskModeEnabled((enabled) => resolve(!!enabled)); }
    catch { resolve(false); }
  });
}