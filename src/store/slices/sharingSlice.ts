import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface SharingState {
    shareCode: string | null;
    serverPort: number;
    connectedClientIp: string | null;
    streamingActive: boolean;
    streamBitrate: number;
    streamFps: number;
    bytesTransferred: number;
    sessionDuration: number;
    remoteControlEnabled: boolean;
    advertisingActive: boolean;
}

const initialState: SharingState = {
    shareCode: null, serverPort: 8765, connectedClientIp: null,
    streamingActive: false, streamBitrate: 0, streamFps: 0,
    bytesTransferred: 0, sessionDuration: 0,
    remoteControlEnabled: true, advertisingActive: false,
};

export const sharingSlice = createSlice({
    name: 'sharing',
    initialState,
    reducers: {
        setShareCode(s, a: PayloadAction<string>) { s.shareCode = a.payload; },
        setServerPort(s, a: PayloadAction<number>) { s.serverPort = a.payload; },
        setConnectedClient(s, a: PayloadAction<string | null>) { s.connectedClientIp = a.payload; },
        setStreamingActive(s, a: PayloadAction<boolean>) { s.streamingActive = a.payload; },
        updateStreamStats(s, a: PayloadAction<{ bitrate: number; fps: number; bytes: number }>) {
            s.streamBitrate = a.payload.bitrate; s.streamFps = a.payload.fps; s.bytesTransferred = a.payload.bytes;
        },
        incrementSessionDuration(s) { s.sessionDuration += 1; },
        setRemoteControlEnabled(s, a: PayloadAction<boolean>) { s.remoteControlEnabled = a.payload; },
        setAdvertisingActive(s, a: PayloadAction<boolean>) { s.advertisingActive = a.payload; },
        resetSharing(s) { Object.assign(s, initialState); },
    },
});

export const { setShareCode, setServerPort, setConnectedClient, setStreamingActive,
    updateStreamStats, incrementSessionDuration, setRemoteControlEnabled,
    setAdvertisingActive, resetSharing } = sharingSlice.actions;
export default sharingSlice.reducer;