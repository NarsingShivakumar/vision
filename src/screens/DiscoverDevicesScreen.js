import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    FlatList, TextInput, SafeAreaView, ActivityIndicator,
} from 'react-native';
import { DiscoveryService } from '../services/DiscoveryService';
import { formatCode } from '../utils/roomCode';

export default function DiscoverDevicesScreen({ navigation, route }) {
    const [peers, setPeers] = useState([]);
    const [scanning, setScanning] = useState(true);
    const [manualIp, setManualIp] = useState(route.params?.prefillIp || '');
    const [manualCode, setManualCode] = useState(route.params?.prefillCode || '');
    const [tab, setTab] = useState('discover');

    useEffect(() => {
        DiscoveryService.clearPeers();
        DiscoveryService.startScanning(setPeers);
        setScanning(true);
        const t = setTimeout(() => setScanning(false), 8000);
        return () => {
            clearTimeout(t);
            DiscoveryService.stopScanning(setPeers);
        };
    }, []);

    const connectTo = useCallback((ip, roomCode, deviceName) => {
        navigation.navigate('RemoteViewer', { serverIp: ip, roomCode, deviceName });
    }, [navigation]);

    const connectManual = useCallback(() => {
        const code = formatCode(manualCode);
        if (!manualIp.trim() || code.length < 4) {
            return;
        }
        connectTo(manualIp.trim(), code, 'Manual Device');
    }, [manualIp, manualCode, connectTo]);

    return (
        <SafeAreaView style={s.safe}>
            <View style={s.tabs}>
                {['discover', 'manual'].map(t => (
                    <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
                        <Text style={[s.tabTxt, tab === t && s.tabTxtActive]}>
                            {t === 'discover' ? '📡 Auto Discover' : '⌨️ Manual Entry'}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {tab === 'discover' && (
                <View style={s.flex}>
                    <View style={s.scanHeader}>
                        {scanning && <ActivityIndicator color="#60b3ff" style={s.spinner} />}
                        <Text style={s.scanTxt}>{scanning ? 'Scanning LAN…' : `${peers.length} device(s) found`}</Text>
                    </View>

                    <FlatList
                        data={peers}
                        keyExtractor={item => item.roomCode}
                        contentContainerStyle={peers.length === 0 ? s.emptyContainer : {}}
                        ListEmptyComponent={
                            <View style={s.empty}>
                                <Text style={s.emptyIcon}>🔍</Text>
                                <Text style={s.emptyTxt}>No devices found yet.</Text>
                                <Text style={s.emptyHint}>Make sure the other device is sharing its screen on the same Wi-Fi, or use Manual Entry.</Text>
                            </View>
                        }
                        renderItem={({ item }) => (
                            <TouchableOpacity
                                style={s.peerCard}
                                onPress={() => connectTo(item.ip, item.roomCode, item.deviceName)}
                            >
                                <View style={s.peerLeft}>
                                    <Text style={s.peerIcon}>📱</Text>
                                    <View>
                                        <Text style={s.peerName}>{item.deviceName}</Text>
                                        <Text style={s.peerMeta}>{item.ip} · Room: {item.roomCode}</Text>
                                    </View>
                                </View>
                                <Text style={s.connect}>Connect ›</Text>
                            </TouchableOpacity>
                        )}
                    />
                </View>
            )}

            {tab === 'manual' && (
                <View style={s.manual}>
                    <Text style={s.fieldLabel}>Server IP Address</Text>
                    <TextInput
                        style={s.input}
                        value={manualIp}
                        onChangeText={setManualIp}
                        placeholder="e.g. 192.168.1.100"
                        placeholderTextColor="#444d66"
                        keyboardType="numeric"
                    />
                    <Text style={s.fieldLabel}>Room Code</Text>
                    <TextInput
                        style={[s.input, s.codeInput]}
                        value={manualCode}
                        onChangeText={v => setManualCode(formatCode(v))}
                        placeholder="e.g. AB3F72"
                        placeholderTextColor="#444d66"
                        autoCapitalize="characters"
                        maxLength={6}
                    />
                    <TouchableOpacity style={s.connectBtn} onPress={connectManual}>
                        <Text style={s.connectBtnTxt}>Connect</Text>
                    </TouchableOpacity>
                    <Text style={s.manualHint}>
                        Get the IP from Settings → Wi-Fi on the host device.{'\n'}
                        Get the room code from the Share Screen on the host device.
                    </Text>
                </View>
            )}
        </SafeAreaView>
    );
}

const s = StyleSheet.create({
    safe: { flex: 1, backgroundColor: '#0f1120' },
    flex: { flex: 1 },
    tabs: { flexDirection: 'row', backgroundColor: '#1c2035', padding: 4, margin: 16, borderRadius: 12 },
    tab: { flex: 1, padding: 10, alignItems: 'center', borderRadius: 10 },
    tabActive: { backgroundColor: '#1565c0' },
    tabTxt: { fontSize: 13, color: '#555e7a', fontWeight: '600' },
    tabTxtActive: { color: '#fff' },
    scanHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
    spinner: { marginRight: 8 },
    scanTxt: { fontSize: 13, color: '#8892a4' },
    emptyContainer: { flex: 1 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
    emptyIcon: { fontSize: 48, marginBottom: 12 },
    emptyTxt: { fontSize: 18, fontWeight: '700', color: '#e0e6f5', marginBottom: 8 },
    emptyHint: { fontSize: 13, color: '#555e7a', textAlign: 'center', lineHeight: 20 },
    peerCard: {
        backgroundColor: '#1c2035', margin: 12, marginTop: 0, borderRadius: 16,
        padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    peerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    peerIcon: { fontSize: 28 },
    peerName: { fontSize: 15, fontWeight: '700', color: '#e0e6f5' },
    peerMeta: { fontSize: 12, color: '#555e7a', marginTop: 2 },
    connect: { fontSize: 14, color: '#60b3ff', fontWeight: '700' },
    manual: { padding: 20 },
    fieldLabel: { fontSize: 12, color: '#8892a4', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
    input: {
        backgroundColor: '#1c2035', borderRadius: 12, padding: 14,
        color: '#e0e6f5', fontSize: 16, marginBottom: 16, borderWidth: 1, borderColor: '#2a3050',
    },
    codeInput: { fontSize: 24, fontWeight: '800', letterSpacing: 8, textAlign: 'center' },
    connectBtn: { backgroundColor: '#4a148c', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 16 },
    connectBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 17 },
    manualHint: { fontSize: 12, color: '#444d66', lineHeight: 20, textAlign: 'center' },
});