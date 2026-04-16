import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    Dimensions, PanResponder, TextInput,
    SafeAreaView, Modal, Alert,
} from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useSession } from '../hooks/useSession';
import { WebRTCService } from '../services/WebRTCService';
import { SignalingService } from '../services/SignalingService';
import { StorageService } from '../services/StorageService';
import { MSG } from '../utils/constants';
import {
    makeTap, makeLongPress, makeSwipe, makeScroll, makeKeyText, makeGlobal,
} from '../utils/controlSchema';
import StatsBar from '../components/StatsBar';
import ReconnectBanner from '../components/ReconnectBanner';

const { width: SW, height: SH } = Dimensions.get('window');

const CONTROL_MODES = ['tap', 'swipe', 'scroll'];

export default function RemoteViewerScreen({ navigation, route }) {
    const { serverIp, roomCode, deviceName } = route.params;
    const serverUrl = `http://${serverIp}:3838`;

    const [remoteStream, setRemoteStream] = useState(null);
    const [controlMode, setControlMode] = useState('tap');
    const [ctrlEnabled, setCtrlEnabled] = useState(false);
    const [showKeyboard, setShowKeyboard] = useState(false);
    const [keyboardText, setKeyboardText] = useState('');
    const [showOverlay, setShowOverlay] = useState(true);
    const [consentSent, setConsentSent] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const timerRef = useRef(null);
    const viewRef = useRef(null);

    const { connState, stats, error, connect, disconnect } = useSession({
        role: 'controller',
        serverUrl,
        roomCode,
        onRemoteStream: stream => {
            setRemoteStream(stream);
            _startTimer();
            StorageService.addPairEntry({ roomCode, deviceName: deviceName || 'Host Device', ip: serverIp });
        },
    });

    useEffect(() => {
        connect();
        // Listen for control consent acknowledgement from host
        const unsub = WebRTCService.onControlMessage(msg => {
            if (msg.type === MSG.CTRL_CONSENT_ACK) {
                if (msg.granted) {
                    setCtrlEnabled(true);
                    Alert.alert('✅ Remote Control Enabled', 'The host has granted remote control access.');
                } else {
                    Alert.alert('❌ Declined', 'The host declined remote control.');
                }
            }
        });
        return () => { unsub?.(); disconnect(); _stopTimer(); };
    }, []);

    function _startTimer() {
        timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    }
    function _stopTimer() { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } }

    const requestControl = useCallback(() => {
        if (consentSent) return;
        Alert.alert(
            'Request Remote Control',
            'This will ask the host device for permission to control it. The host must accept before any control commands are sent.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Request Control', onPress: () => {
                        WebRTCService.sendControl({ type: MSG.CTRL_CONSENT_REQUEST });
                        setConsentSent(true);
                        Alert.alert('Request Sent', 'Waiting for the host to accept remote control…');
                    },
                },
            ]
        );
    }, [consentSent]);

    // Convert touch coordinates from viewer space to normalized coords
    function normalize(x, y) {
        return { nx: x / SW, ny: y / SH };
    }

    const sendCommand = useCallback((msg) => {
        if (!ctrlEnabled) return;
        WebRTCService.sendControl(msg);
    }, [ctrlEnabled]);

    const panResponder = PanResponder.create({
        onStartShouldSetPanResponder: () => ctrlEnabled,
        onMoveShouldSetPanResponder: () => ctrlEnabled,

        onPanResponderGrant: (e) => {
            const { locationX: x, locationY: y } = e.nativeEvent;
            if (controlMode === 'tap') {
                sendCommand(makeTap(...Object.values(normalize(x, y))));
            }
        },

        onPanResponderRelease: (e, g) => {
            const { locationX: sx, locationY: sy } = e.nativeEvent;
            const { dx, dy } = g;
            const { nx, ny } = normalize(sx, sy);
            const { nx: ex, ny: ey } = normalize(sx + dx, sy + dy);

            if (controlMode === 'swipe' && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
                sendCommand(makeSwipe(nx, ny, ex, ey, 250));
            } else if (controlMode === 'scroll') {
                const dir = Math.abs(dy) > Math.abs(dx)
                    ? (dy < 0 ? 'up' : 'down')
                    : (dx < 0 ? 'left' : 'right');
                sendCommand(makeScroll(nx, ny, dir));
            }
        },

        onPanResponderTerminate: () => { },
    });

    const sendGlobal = (action) => sendCommand(makeGlobal(action));

    const sendText = () => {
        if (keyboardText.trim()) sendCommand(makeKeyText(keyboardText));
        setKeyboardText('');
        setShowKeyboard(false);
    };

    const stopSession = () => {
        Alert.alert('Stop Session', 'End the remote viewing session?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Stop', style: 'destructive', onPress: () => { disconnect(); navigation.goBack(); } },
        ]);
    };

    return (
        <View style={s.root}>
            {/* Remote stream fullscreen */}
            {remoteStream ? (
                <RTCView
                    streamURL={remoteStream.toURL()}
                    style={s.stream}
                    objectFit="contain"
                    mirror={false}
                    {...panResponder.panHandlers}
                />
            ) : (
                <View style={[s.stream, s.waiting]}>
                    <Text style={s.waitTxt}>Connecting to {deviceName || roomCode}…</Text>
                </View>
            )}

            {/* Reconnect banner */}
            <View style={s.topBanner}>
                <ReconnectBanner connState={connState} onReconnect={connect} />
            </View>

            {/* Stats bar */}
            {remoteStream && (
                <View style={s.statsPos}>
                    <StatsBar stats={stats} connState={connState} elapsed={elapsed} />
                </View>
            )}

            {/* Overlay controls */}
            {showOverlay && (
                <SafeAreaView style={s.overlay} pointerEvents="box-none">
                    {/* Control mode selector */}
                    <View style={s.modeRow}>
                        {CONTROL_MODES.map(mode => (
                            <TouchableOpacity
                                key={mode}
                                style={[s.modeBtn, controlMode === mode && s.modeBtnActive]}
                                onPress={() => setControlMode(mode)}
                            >
                                <Text style={s.modeTxt}>{mode}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* Global action buttons */}
                    <View style={s.globalRow}>
                        <TouchableOpacity style={s.globalBtn} onPress={() => sendGlobal('back')}>
                            <Text style={s.globalTxt}>◁ Back</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.globalBtn} onPress={() => sendGlobal('home')}>
                            <Text style={s.globalTxt}>○ Home</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.globalBtn} onPress={() => sendGlobal('recents')}>
                            <Text style={s.globalTxt}>□ Recent</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.globalBtn} onPress={() => setShowKeyboard(true)}>
                            <Text style={s.globalTxt}>⌨ Text</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Bottom controls */}
                    <View style={s.bottomRow}>
                        {!ctrlEnabled ? (
                            <TouchableOpacity style={s.requestCtrlBtn} onPress={requestControl}>
                                <Text style={s.requestCtrlTxt}>🎮 Request Control</Text>
                            </TouchableOpacity>
                        ) : (
                            <View style={s.ctrlBadge}><Text style={s.ctrlBadgeTxt}>🟢 Control Active</Text></View>
                        )}
                        <TouchableOpacity style={s.stopBtn} onPress={stopSession}>
                            <Text style={s.stopTxt}>⏹ Stop</Text>
                        </TouchableOpacity>
                    </View>
                </SafeAreaView>
            )}

            {/* Show/hide overlay toggle */}
            <TouchableOpacity style={s.toggleOverlay} onPress={() => setShowOverlay(v => !v)}>
                <Text style={s.toggleTxt}>{showOverlay ? '▼' : '▲'}</Text>
            </TouchableOpacity>

            {/* Text input modal */}
            <Modal visible={showKeyboard} transparent animationType="slide">
                <View style={s.kbModal}>
                    <View style={s.kbCard}>
                        <Text style={s.kbTitle}>Send Text to Host</Text>
                        <TextInput
                            style={s.kbInput}
                            value={keyboardText}
                            onChangeText={setKeyboardText}
                            placeholder="Type text to send…"
                            autoFocus
                            multiline
                        />
                        <View style={s.kbBtns}>
                            <TouchableOpacity style={s.kbCancel} onPress={() => setShowKeyboard(false)}>
                                <Text style={s.kbCancelTxt}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.kbSend} onPress={sendText}>
                                <Text style={s.kbSendTxt}>Send ⏎</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000' },
    stream: { ...StyleSheet.absoluteFillObject },
    waiting: { justifyContent: 'center', alignItems: 'center' },
    waitTxt: { color: '#fff', fontSize: 16 },
    topBanner: { position: 'absolute', top: 0, left: 0, right: 0 },
    statsPos: { position: 'absolute', top: 44, alignSelf: 'center' },
    overlay: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: 20 },
    modeRow: {
        flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 10,
    },
    modeBtn: {
        paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
    },
    modeBtnActive: { backgroundColor: '#1565c0', borderColor: '#1565c0' },
    modeTxt: { color: '#fff', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
    globalRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 10 },
    globalBtn: {
        backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 14, paddingVertical: 8,
        borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    },
    globalTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },
    bottomRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, alignItems: 'center' },
    requestCtrlBtn: { backgroundColor: '#4a148c', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 },
    requestCtrlTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
    ctrlBadge: { backgroundColor: '#1b5e20', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
    ctrlBadgeTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
    stopBtn: { backgroundColor: '#b71c1c', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 },
    stopTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
    toggleOverlay: {
        position: 'absolute', top: '50%', right: 12,
        backgroundColor: 'rgba(0,0,0,0.5)', width: 36, height: 36,
        borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    },
    toggleTxt: { color: '#fff', fontSize: 14 },
    kbModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    kbCard: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
    kbTitle: { fontSize: 17, fontWeight: '700', marginBottom: 12, color: '#1a1d2e' },
    kbInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, fontSize: 15, minHeight: 80, marginBottom: 14 },
    kbBtns: { flexDirection: 'row', gap: 10 },
    kbCancel: { flex: 1, backgroundColor: '#f5f5f5', borderRadius: 10, padding: 14, alignItems: 'center' },
    kbCancelTxt: { fontWeight: '600', color: '#333' },
    kbSend: { flex: 1, backgroundColor: '#1565c0', borderRadius: 10, padding: 14, alignItems: 'center' },
    kbSendTxt: { fontWeight: '700', color: '#fff' },
});