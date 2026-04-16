import { NativeModules } from 'react-native';
import { DISCOVERY_PORT } from '../utils/constants';

// UDP broadcast discovery — falls back to manual IP if blocked by network policy.
const { LanDiscovery } = NativeModules;

const peers = new Map();
const cbs = new Set();

export const DiscoveryService = {
    startAdvertising(roomCode, deviceName) {
        try { LanDiscovery?.startAdvertising(roomCode, deviceName, DISCOVERY_PORT); }
        catch (e) { console.warn('[Discovery] advertise failed:', e); }
    },

    stopAdvertising() {
        try { LanDiscovery?.stopAdvertising(); } catch { }
    },

    startScanning(onUpdate) {
        cbs.add(onUpdate);
        try {
            LanDiscovery?.startScanning(DISCOVERY_PORT, peer => {
                peers.set(peer.roomCode, { ...peer, seenAt: Date.now() });
                const list = [...peers.values()];
                cbs.forEach(cb => cb(list));
            });
        } catch (e) { console.warn('[Discovery] scan failed:', e); }
    },

    stopScanning(onUpdate) {
        cbs.delete(onUpdate);
        if (cbs.size === 0) try { LanDiscovery?.stopScanning(); } catch { }
    },

    clearPeers() { peers.clear(); },
    getPeers: () => [...peers.values()],
};