import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function ReconnectBanner({ connState, onReconnect }) {
    if (!['disconnected', 'peer_left', 'error', 'reconnecting'].includes(connState)) return null;

    const isReconnecting = connState === 'reconnecting';

    return (
        <View style={s.banner}>
            <Text style={s.msg}>
                {isReconnecting ? '🔄 Reconnecting…' :
                    connState === 'peer_left' ? '⚠️ The other device disconnected.' :
                        '⚠️ Connection lost.'}
            </Text>
            {!isReconnecting && (
                <TouchableOpacity style={s.btn} onPress={onReconnect}>
                    <Text style={s.btnTxt}>Retry</Text>
                </TouchableOpacity>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    banner: {
        backgroundColor: '#b71c1c', flexDirection: 'row', alignItems: 'center',
        justifyContent: 'space-between', padding: 12, paddingHorizontal: 16,
    },
    msg: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
    btn: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6, marginLeft: 10 },
    btnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
});