import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface DiscoveredDevice {
    id: string; name: string; ipAddress: string;
    port: number; shareCode: string; lastSeen: number;
    signalStrength?: 'strong' | 'medium' | 'weak';
}

interface DiscoveryState {
    isScanning: boolean;
    discoveredDevices: DiscoveredDevice[];
    scanError: string | null;
    lastScanTime: number | null;
}

export const discoverySlice = createSlice({
    name: 'discovery',
    initialState: { isScanning: false, discoveredDevices: [], scanError: null, lastScanTime: null } as DiscoveryState,
    reducers: {
        setScanning(s, a: PayloadAction<boolean>) { s.isScanning = a.payload; if (a.payload) s.scanError = null; },
        addOrUpdateDevice(s, a: PayloadAction<DiscoveredDevice>) {
            const idx = s.discoveredDevices.findIndex(d => d.id === a.payload.id);
            if (idx >= 0) s.discoveredDevices[idx] = a.payload;
            else s.discoveredDevices.push(a.payload);
        },
        removeDevice(s, a: PayloadAction<string>) { s.discoveredDevices = s.discoveredDevices.filter(d => d.id !== a.payload); },
        clearDevices(s) { s.discoveredDevices = []; },
        setScanError(s, a: PayloadAction<string | null>) { s.scanError = a.payload; s.isScanning = false; },
        setLastScanTime(s, a: PayloadAction<number>) { s.lastScanTime = a.payload; },
        pruneStaleDevices(s) {
            const cutoff = Date.now() - 10000;
            s.discoveredDevices = s.discoveredDevices.filter(d => d.lastSeen > cutoff);
        },
    },
});

export const { setScanning, addOrUpdateDevice, removeDevice, clearDevices,
    setScanError, setLastScanTime, pruneStaleDevices } = discoverySlice.actions;
export default discoverySlice.reducer;