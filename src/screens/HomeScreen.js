import React, { useEffect, useState } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    ScrollView, SafeAreaView, StatusBar,
} from 'react-native';
import { StorageService } from '../services/StorageService';

export default function HomeScreen({ navigation }) {
    const [history, setHistory] = useState([]);

    useEffect(() => {
        StorageService.getPairHistory().then(setHistory);
        const unsub = navigation.addListener('focus', () =>
            StorageService.getPairHistory().then(setHistory)
        );
        return unsub;
    }, [navigation]);

    return (
        <SafeAreaView style={s.safe}>
            <StatusBar barStyle="light-content" backgroundColor="#1a1d2e" />
            <ScrollView contentContainerStyle={s.scroll}>
                <View style={s.hero}>
                    <Text style={s.appName}>📺 ScreenCast</Text>
                    <Text style={s.tagline}>Offline LAN Screen Sharing</Text>
                    <View style={s.badge}><Text style={s.badgeTxt}>● Same Wi-Fi Only · No Internet Needed</Text></View>
                </View>

                <TouchableOpacity style={[s.card, s.cardBlue]} onPress={() => navigation.navigate('ShareScreen')}>
                    <Text style={s.cardIcon}>📡</Text>
                    <Text style={s.cardTitle}>Share My Screen</Text>
                    <Text style={s.cardSub}>Host mode — stream your Android screen to another device on the same Wi-Fi</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[s.card, s.cardPurple]} onPress={() => navigation.navigate('DiscoverDevices')}>
                    <Text style={s.cardIcon}>🎮</Text>
                    <Text style={s.cardTitle}>Control a Device</Text>
                    <Text style={s.cardSub}>Viewer mode — watch and remotely control another device over LAN</Text>
                </TouchableOpacity>

                <View style={s.row}>
                    <TouchableOpacity style={s.pill} onPress={() => navigation.navigate('PermissionCenter')}>
                        <Text style={s.pillTxt}>🔐 Permissions</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.pill} onPress={() => navigation.navigate('Settings')}>
                        <Text style={s.pillTxt}>⚙️ Settings</Text>
                    </TouchableOpacity>
                </View>

                {history.length > 0 && (
                    <View style={s.section}>
                        <Text style={s.sectionLabel}>RECENT DEVICES</Text>
                        {history.map(item => (
                            <TouchableOpacity
                                key={item.roomCode}
                                style={s.histItem}
                                onPress={() => navigation.navigate('DiscoverDevices', {
                                    prefillCode: item.roomCode, prefillIp: item.ip,
                                })}
                            >
                                <View style={s.histLeft}>
                                    <Text style={s.histName}>{item.deviceName || 'Unknown Device'}</Text>
                                    <Text style={s.histMeta}>Room: {item.roomCode} · {item.ip}</Text>
                                </View>
                                <Text style={s.arrow}>›</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}

                <Text style={s.footer}>
                    Remote control limited to AccessibilityService APIs.{'\n'}
                    Full root-level control is not possible on unrooted devices.
                </Text>
            </ScrollView>
        </SafeAreaView>
    );
}

const s = StyleSheet.create({
    safe: { flex: 1, backgroundColor: '#0f1120' },
    scroll: { padding: 20, paddingBottom: 48 },
    hero: { alignItems: 'center', paddingVertical: 24 },
    appName: { fontSize: 36, fontWeight: '900', color: '#fff', letterSpacing: -1 },
    tagline: { fontSize: 14, color: '#8892a4', marginTop: 4 },
    badge: { backgroundColor: '#1e3a5f', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5, marginTop: 10 },
    badgeTxt: { fontSize: 11, color: '#60b3ff', fontWeight: '700' },
    card: { borderRadius: 20, padding: 22, marginBottom: 14, elevation: 4 },
    cardBlue: { backgroundColor: '#1565c0' },
    cardPurple: { backgroundColor: '#6a1b9a' },
    cardIcon: { fontSize: 36, marginBottom: 8 },
    cardTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },
    cardSub: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 4, lineHeight: 20 },
    row: { flexDirection: 'row', gap: 12, marginBottom: 24 },
    pill: {
        flex: 1, backgroundColor: '#1c2035', borderRadius: 14,
        padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#2a3050',
    },
    pillTxt: { fontSize: 14, color: '#cbd3e8', fontWeight: '600' },
    section: { marginTop: 4 },
    sectionLabel: { fontSize: 11, color: '#555e7a', fontWeight: '700', letterSpacing: 1.2, marginBottom: 8, textTransform: 'uppercase' },
    histItem: {
        backgroundColor: '#1c2035', borderRadius: 14, padding: 14,
        marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    histLeft: { flex: 1 },
    histName: { fontSize: 15, fontWeight: '700', color: '#e0e6f5' },
    histMeta: { fontSize: 12, color: '#666e8a', marginTop: 2 },
    arrow: { fontSize: 22, color: '#444d66' },
    footer: { fontSize: 11, color: '#444d66', textAlign: 'center', marginTop: 24, lineHeight: 18 },
});