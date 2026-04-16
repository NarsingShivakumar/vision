import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = { PAIR_HISTORY: 'sc_pair_history', SETTINGS: 'sc_settings' };

const defaultSettings = () => ({
    audioEnabled: false,
    videoBitrate: 2000,
    videoFps: 30,
    deviceName: 'My Device',
});

export const StorageService = {
    async getPairHistory() {
        try {
            const raw = await AsyncStorage.getItem(KEYS.PAIR_HISTORY);
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    },

    async addPairEntry({ roomCode, deviceName, ip }) {
        const history = await this.getPairHistory();
        const filtered = history.filter(h => h.roomCode !== roomCode);
        const updated = [{ roomCode, deviceName, ip, lastConnected: Date.now() }, ...filtered].slice(0, 20);
        await AsyncStorage.setItem(KEYS.PAIR_HISTORY, JSON.stringify(updated));
    },

    async removePairEntry(roomCode) {
        const history = await this.getPairHistory();
        await AsyncStorage.setItem(
            KEYS.PAIR_HISTORY,
            JSON.stringify(history.filter(h => h.roomCode !== roomCode))
        );
    },

    async getSettings() {
        try {
            const raw = await AsyncStorage.getItem(KEYS.SETTINGS);
            return raw ? { ...defaultSettings(), ...JSON.parse(raw) } : defaultSettings();
        } catch { return defaultSettings(); }
    },

    async saveSettings(settings) {
        await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
    },
};