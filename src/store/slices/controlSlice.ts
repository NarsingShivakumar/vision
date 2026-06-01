import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'receiving' | 'reconnecting' | 'disconnected';

interface ControlState {
    connectionState: ConnectionState;
    connectedDeviceIp: string | null;
    connectedDeviceName: string | null;
    connectedPort: number | null;
    frameWidth: number; frameHeight: number;
    latencyMs: number; reconnectAttempts: number;
    maxReconnectAttempts: number;
    showTouchIndicator: boolean; controlsLocked: boolean; fullscreenMode: boolean;
}

export const controlSlice = createSlice({
    name: 'control',
    initialState: {
        connectionState: 'idle', connectedDeviceIp: null, connectedDeviceName: null,
        connectedPort: null, frameWidth: 1080, frameHeight: 1920, latencyMs: 0,
        reconnectAttempts: 0, maxReconnectAttempts: 5,
        showTouchIndicator: true, controlsLocked: false, fullscreenMode: false,
    } as ControlState,
    reducers: {
        setConnectionState(s, a: PayloadAction<ConnectionState>) {
            s.connectionState = a.payload;
            if (a.payload === 'connected' || a.payload === 'receiving') s.reconnectAttempts = 0;
        },
        setConnectedDevice(s, a: PayloadAction<{ ip: string; name: string; port: number } | null>) {
            if (a.payload) {
                s.connectedDeviceIp = a.payload.ip; s.connectedDeviceName = a.payload.name; s.connectedPort = a.payload.port;
            } else {
                s.connectedDeviceIp = null; s.connectedDeviceName = null; s.connectedPort = null;
            }
        },
        setFrameDimensions(s, a: PayloadAction<{ width: number; height: number }>) {
            s.frameWidth = a.payload.width; s.frameHeight = a.payload.height;
        },
        setLatency(s, a: PayloadAction<number>) { s.latencyMs = a.payload; },
        incrementReconnectAttempts(s) { s.reconnectAttempts += 1; },
        setShowTouchIndicator(s, a: PayloadAction<boolean>) { s.showTouchIndicator = a.payload; },
        setControlsLocked(s, a: PayloadAction<boolean>) { s.controlsLocked = a.payload; },
        setFullscreenMode(s, a: PayloadAction<boolean>) { s.fullscreenMode = a.payload; },
        resetControl(s) { Object.assign(s, controlSlice.getInitialState()); },
    },
});

export const { setConnectionState, setConnectedDevice, setFrameDimensions, setLatency,
    incrementReconnectAttempts, setShowTouchIndicator, setControlsLocked,
    setFullscreenMode, resetControl } = controlSlice.actions;
export default controlSlice.reducer;