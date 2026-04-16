import React, { useEffect, useState } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, Switch,
    StyleSheet, ScrollView, SafeAreaView, Alert,
} from 'react-native';
import { StorageService } from '../services/StorageService';

export default function SettingsScreen() {
    const [settings, setSettings] = useState(null);
    const [serverIp, setServerIp] = useState('');
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        StorageService.getSettings().then(s => {
            setSettings(s);
            setServerIp(s.lastServerIp || '');
        });
    }, []);

    const save = async () => {
        await StorageService.saveSettings({ ...settings, lastServerIp: serverIp });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const clearHistory = async () => {
        Alert.alert('Clear History', 'Remove all paired device history?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Clear', style: 'destructive', onPress: async () => {
                    const { AsyncStorage } = await import('@react-native-async-storage/async-storage');
                    // Remove pair history key
                    const { default: AS } = await import('@react-native-async-storage/async-storage');
                    await AS.removeItem('sc_pair_history');
                    Alert.alert('Cleared', 'Pairing history has been removed.');
                }
            },
        ]);
    };

    if (!settings) return null;

    return (
        <SafeAreaView style={s.safe}>
            <ScrollView contentContainerStyle={s.scroll}>

                <Text style={s.sectionLabel}>DEVICE</Text>
                <View style={s.card}>
                    <Text style={s.fieldLabel}>Device Name</Text>
                    <TextInput
                        style={s.input}
                        value={settings.deviceName}
                        onChangeText={v => setSettings(p => ({ ...p, deviceName: v }))}
                        placeholder="My Android Device"
                        placeholderTextColor="#444d66"
                    />
                </View>

                <Text style={s.sectionLabel}>SIGNALING SERVER</Text>
                <View style={s.card}>
                    <Text style={s.fieldLabel}>Server IP (this or another device on LAN)</Text>
                    <TextInput
                        style={s.input}
                        value={serverIp}
                        onChangeText={setServerIp}
                        placeholder="192.168.1.100"
                        placeholderTextColor="#444d66"
                        keyboardType="numeric"
                    />
                    <Text style={s.hint}>Port 3838 is fixed. Run `node signaling-server/server.js` on any device on your Wi-Fi.</Text>
                </View>

                <Text style={s.sectionLabel}>STREAMING</Text>
                <View style={s.card}>
                    <View style={s.row}>
                        <View style={s.rowLeft}>
                            <Text style={s.rowTitle}>Audio Streaming</Text>
                            <Text style={s.rowSub}>Stream device audio to viewer (requires Microphone permission)</Text>
                        </View>
                        <Switch
                            value={settings.audioEnabled}
                            onValueChange={v => setSettings(p => ({ ...p, audioEnabled: v }))}
                            trackColor={{ false: '#2a3050', true: '#1565c0' }}
                            thumbColor="#fff"
                        />
                    </View>

                    <Text style={s.fieldLabel}>Video Bitrate (kbps)</Text>
                    <TextInput
                        style={s.input}
                        value={String(settings.videoBitrate)}
                        onChangeText={v => setSettings(p => ({ ...p, videoBitrate: parseInt(v) || 2000 }))}
                        keyboardType="numeric"
                        placeholderTextColor="#444d66"
                    />

                    <Text style={s.fieldLabel}>Target FPS</Text>
                    <View style={s.fpsRow}>
                        {[15, 24, 30, 60].map(fps => (
                            <TouchableOpacity
                                key={fps}
                                style={[s.fpsBtn, settings.videoFps === fps && s.fpsBtnActive]}
                                onPress={() => setSettings(p => ({ ...p, videoFps: fps }))}
                            >
                                <Text style={[s.fpsTxt, settings.videoFps === fps && s.fpsTxtActive]}>{fps}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                <TouchableOpacity style={s.saveBtn} onPress={save}>
                    <Text style={s.saveBtnTxt}>{saved ? '✅ Saved!' : 'Save Settings'}</Text>
                </TouchableOpacity>

                <TouchableOpacity style={s.dangerBtn} onPress={clearHistory}>
                    <Text style={s.dangerBtnTxt}>🗑 Clear Pairing History</Text>
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}

const s = StyleSheet.create({
    safe: { flex: 1, backgroundColor: '#0f1120' },
    scroll: { padding: 16, paddingBottom: 48 },
    sectionLabel: { fontSize: 11, color: '#555e7a', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8, marginTop: 16 },
    card: { backgroundColor: '#1c2035', borderRadius: 16, padding: 16, marginBottom: 4 },
    fieldLabel: { fontSize: 12, color: '#8892a4', marginBottom: 8, fontWeight: '600' },
    input: {
        backgroundColor: '#0f1120', borderRadius: 10, padding: 12,
        color: '#e0e6f5', fontSize: 15, borderWidth: 1, borderColor: '#2a3050', marginBottom: 8,
    },
    hint: { fontSize: 12, color: '#444d66', lineHeight: 18, marginTop: 4 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    rowLeft: { flex: 1, marginRight: 12 },
    rowTitle: { fontSize: 15, fontWeight: '700', color: '#e0e6f5' },
    rowSub: { fontSize: 12, color: '#555e7a', marginTop: 2, lineHeight: 18 },
    fpsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
    fpsBtn: { flex: 1, backgroundColor: '#0f1120', borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#2a3050' },
    fpsBtnActive: { backgroundColor: '#1565c0', borderColor: '#1565c0' },
    fpsTxt: { fontSize: 16, fontWeight: '700', color: '#555e7a' },
    fpsTxtActive: { color: '#fff' },
    saveBtn: { backgroundColor: '#1565c0', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 20 },
    saveBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 16 },
    dangerBtn: { backgroundColor: '#1c1010', borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: '#4a1010' },
    dangerBtnTxt: { color: '#e57373', fontWeight: '600', fontSize: 14 },
});