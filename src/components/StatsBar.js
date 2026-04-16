import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function StatsBar({ stats, connState, elapsed }) {
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');

    const stateColor = {
        connected: '#4caf50',
        connecting: '#ff9800',
        disconnected: '#f44336',
        reconnecting: '#ff9800',
    }[connState] || '#888';

    return (
        <View style={s.bar}>
            <View style={[s.dot, { backgroundColor: stateColor }]} />
            <Text style={s.txt}>{connState.toUpperCase()}</Text>
            <Text style={s.sep}>|</Text>
            <Text style={s.txt}>{stats.bitrate} kbps</Text>
            <Text style={s.sep}>|</Text>
            <Text style={s.txt}>{stats.fps} fps</Text>
            <Text style={s.sep}>|</Text>
            <Text style={s.txt}>{stats.rtt} ms</Text>
            {elapsed > 0 && <><Text style={s.sep}>|</Text><Text style={s.txt}>⏱ {mm}:{ss}</Text></>}
        </View>
    );
}

const s = StyleSheet.create({
    bar: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)',
        paddingHorizontal: 12, paddingVertical: 6,
        borderRadius: 20, gap: 6,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    txt: { fontSize: 11, color: '#fff', fontWeight: '600' },
    sep: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
});