import React, { useEffect, useState, useCallback } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, ScrollView,
    SafeAreaView, Linking, NativeModules, Alert, Platform,
} from 'react-native';
import { check, PERMISSIONS, RESULTS, openSettings } from 'react-native-permissions';

const { MediaProjectionModule } = NativeModules;

const PERMISSION_DEFS = [
    {
        key: 'record_audio',
        perm: PERMISSIONS.ANDROID.RECORD_AUDIO,
        title: 'Microphone',
        icon: '🎙️',
        why: 'Required for optional audio streaming from the host device to the viewer.',
        optional: true,
    },
    ...(Platform.Version >= 33 ? [{
        key: 'notifications',
        perm: PERMISSIONS.ANDROID.POST_NOTIFICATIONS,
        title: 'Notifications',
        icon: '🔔',
        why: 'Required to show the foreground notification during an active screen sharing session on Android 13+.',
        optional: false,
    }] : []),
];

export default function PermissionCenterScreen() {
    const [statuses, setStatuses] = useState({});
    const [accessibilityEnabled, setAccessibilityEnabled] = useState(false);
    const [projectionGranted, setProjectionGranted] = useState(false);

    const refresh = useCallback(async () => {
        const s = {};
        for (const def of PERMISSION_DEFS) {
            s[def.key] = await check(def.perm);
        }
        setStatuses(s);

        try {
            const acc = await MediaProjectionModule?.isAccessibilityEnabled?.();
            setAccessibilityEnabled(!!acc);
        } catch { }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const requestPerm = async (def) => {
        const { request } = await import('react-native-permissions');
        await request(def.perm);
        refresh();
    };

    const openAccessibility = () => {
        Alert.alert(
            'Enable Accessibility Service',
            'To allow remote control:\n\n1. Open Settings → Accessibility.\n2. Find "ScreenCast Remote Control".\n3. Toggle it ON.\n4. Accept the permission dialog.\n\nNote: Accessibility permission gives ScreenCast the ability to perform taps, swipes, and other gestures on screen. You can disable it at any time.',
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Open Settings', onPress: () => Linking.sendIntent('android.settings.ACCESSIBILITY_SETTINGS') },
            ]
        );
    };

    const statusLabel = (key) => {
        const v = statuses[key];
        if (v === RESULTS.GRANTED) return ['✅ Granted', '#2e7d32'];
        if (v === RESULTS.DENIED) return ['❌ Denied', '#c62828'];
        if (v === RESULTS.BLOCKED) return ['🚫 Blocked', '#e65100'];
        return ['⏳ Not checked', '#888'];
    };

    return (
        <SafeAreaView style={s.safe}>
            <ScrollView contentContainerStyle={s.scroll}>
                <Text style={s.intro}>
                    ScreenCast needs the following permissions and system approvals to function.
                    Each is explained below.
                </Text>

                <Text style={s.sectionTitle}>Runtime Permissions</Text>
                {PERMISSION_DEFS.map(def => {
                    const [label, color] = statusLabel(def.key);
                    return (
                        <View key={def.key} style={s.card}>
                            <View style={s.cardHeader}>
                                <Text style={s.cardIcon}>{def.icon}</Text>
                                <View style={s.cardInfo}>
                                    <Text style={s.cardTitle}>{def.title}{def.optional ? ' (Optional)' : ''}</Text>
                                    <Text style={[s.cardStatus, { color }]}>{label}</Text>
                                </View>
                            </View>
                            <Text style={s.cardWhy}>{def.why}</Text>
                            {statuses[def.key] !== RESULTS.GRANTED && (
                                <View style={s.cardBtns}>
                                    {statuses[def.key] === RESULTS.BLOCKED ? (
                                        <TouchableOpacity style={s.openBtn} onPress={openSettings}>
                                            <Text style={s.openBtnTxt}>Open App Settings</Text>
                                        </TouchableOpacity>
                                    ) : (
                                        <TouchableOpacity style={s.grantBtn} onPress={() => requestPerm(def)}>
                                            <Text style={s.grantBtnTxt}>Grant Permission</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            )}
                        </View>
                    );
                })}

                <Text style={s.sectionTitle}>Special Approvals</Text>

                {/* Screen Capture */}
                <View style={s.card}>
                    <View style={s.cardHeader}>
                        <Text style={s.cardIcon}>📺</Text>
                        <View style={s.cardInfo}>
                            <Text style={s.cardTitle}>Screen Capture (MediaProjection)</Text>
                            <Text style={[s.cardStatus, { color: '#e65100' }]}>
                                ⚡ Requested each session
                            </Text>
                        </View>
                    </View>
                    <Text style={s.cardWhy}>
                        Android requires explicit user approval every time screen capture starts. You will see the system
                        "Start recording?" dialog when you tap "Share My Screen". This is a mandatory Android security requirement
                        and cannot be bypassed.
                    </Text>
                </View>

                {/* Accessibility Service */}
                <View style={s.card}>
                    <View style={s.cardHeader}>
                        <Text style={s.cardIcon}>♿</Text>
                        <View style={s.cardInfo}>
                            <Text style={s.cardTitle}>Accessibility Service (Remote Control)</Text>
                            <Text style={[s.cardStatus, { color: accessibilityEnabled ? '#2e7d32' : '#c62828' }]}>
                                {accessibilityEnabled ? '✅ Enabled' : '❌ Not Enabled'}
                            </Text>
                        </View>
                    </View>
                    <Text style={s.cardWhy}>
                        Required to perform remote gestures (tap, swipe, scroll) and global actions (Back, Home, Recents)
                        on the host device. This is only needed on the HOST device. The controller does not need it.
                        {'\n\n'}⚠️ Remote control has a separate consent dialog — the host must explicitly accept each time
                        a controller requests control.
                    </Text>
                    {!accessibilityEnabled && (
                        <TouchableOpacity style={s.grantBtn} onPress={openAccessibility}>
                            <Text style={s.grantBtnTxt}>Enable Accessibility Service</Text>
                        </TouchableOpacity>
                    )}
                </View>

                <TouchableOpacity style={s.refreshBtn} onPress={refresh}>
                    <Text style={s.refreshBtnTxt}>🔄 Refresh Status</Text>
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}

const s = StyleSheet.create({
    safe: { flex: 1, backgroundColor: '#0f1120' },
    scroll: { padding: 16, paddingBottom: 40 },
    intro: { fontSize: 13, color: '#8892a4', lineHeight: 20, marginBottom: 20 },
    sectionTitle: { fontSize: 11, color: '#555e7a', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10, marginTop: 8 },
    card: { backgroundColor: '#1c2035', borderRadius: 16, padding: 16, marginBottom: 12 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 12 },
    cardIcon: { fontSize: 26 },
    cardInfo: { flex: 1 },
    cardTitle: { fontSize: 15, fontWeight: '700', color: '#e0e6f5' },
    cardStatus: { fontSize: 12, marginTop: 2, fontWeight: '600' },
    cardWhy: { fontSize: 13, color: '#8892a4', lineHeight: 20, marginBottom: 10 },
    cardBtns: { flexDirection: 'row', gap: 10 },
    grantBtn: { flex: 1, backgroundColor: '#1565c0', borderRadius: 10, padding: 12, alignItems: 'center' },
    grantBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
    openBtn: { flex: 1, backgroundColor: '#4a148c', borderRadius: 10, padding: 12, alignItems: 'center' },
    openBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
    refreshBtn: { backgroundColor: '#1c2035', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#2a3050' },
    refreshBtnTxt: { color: '#8892a4', fontWeight: '600', fontSize: 14 },
});