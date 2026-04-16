import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function ConsentDialog({ visible, type, onAccept, onDecline }) {
    const config = type === 'screen_share' ? {
        icon: '📡',
        title: 'Allow Screen Sharing?',
        body: 'Another device on your Wi-Fi network is requesting to view your screen in real time.\n\n• Your entire screen will be captured and streamed.\n• You can stop sharing at any time.\n• No data leaves your local network.',
        accept: 'Share My Screen',
        decline: 'Decline',
    } : {
        icon: '🎮',
        title: 'Allow Remote Control?',
        body: 'The connected device is requesting permission to control this device remotely.\n\n• They may tap, swipe, and type on your screen.\n• Control uses Android AccessibilityService only.\n• You can revoke access at any time by pressing Stop.',
        accept: 'Allow Remote Control',
        decline: 'Deny',
    };

    return (
        <Modal transparent visible={visible} animationType="fade">
            <View style={s.overlay}>
                <View style={s.card}>
                    <Text style={s.icon}>{config.icon}</Text>
                    <Text style={s.title}>{config.title}</Text>
                    <Text style={s.body}>{config.body}</Text>
                    <TouchableOpacity style={s.acceptBtn} onPress={onAccept}>
                        <Text style={s.acceptTxt}>{config.accept}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.declineBtn} onPress={onDecline}>
                        <Text style={s.declineTxt}>{config.decline}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    card: { backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 400 },
    icon: { fontSize: 40, textAlign: 'center', marginBottom: 12 },
    title: { fontSize: 20, fontWeight: '800', color: '#1a1d2e', textAlign: 'center', marginBottom: 12 },
    body: { fontSize: 14, color: '#555', lineHeight: 22, marginBottom: 24 },
    acceptBtn: { backgroundColor: '#1565c0', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 10 },
    acceptTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
    declineBtn: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 14, alignItems: 'center' },
    declineTxt: { color: '#333', fontWeight: '600', fontSize: 15 },
});