import { useState, useEffect, useRef, useCallback } from 'react';
import { SignalingService } from '../services/SignalingService';
import { WebRTCService } from '../services/WebRTCService';
import { MSG } from '../utils/constants';

export function useSession({ role, serverUrl, roomCode, localStream, onRemoteStream }) {
    const [connState, setConnState] = useState('idle');
    const [stats, setStats] = useState({ bitrate: 0, fps: 0, rtt: 0 });
    const [error, setError] = useState(null);
    const mounted = useRef(true);

    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

    const safe = useCallback((fn) => (...args) => { if (mounted.current) fn(...args); }, []);

    const connect = useCallback(async () => {
        setConnState('connecting'); setError(null);
        try {
            await SignalingService.connect(serverUrl);
            SignalingService.emit(MSG.JOIN_ROOM, { roomCode, role });
        } catch (e) {
            setError('Cannot reach signaling server. Confirm the server IP and port ' + serverUrl);
            setConnState('error');
        }
    }, [serverUrl, roomCode, role]);

    const disconnect = useCallback(() => {
        WebRTCService.close();
        SignalingService.disconnect();
        safe(setConnState)('idle');
    }, [safe]);

    useEffect(() => {
        const unsubs = [];

        // HOST: when controller joins, start offer
        unsubs.push(SignalingService.on(MSG.PEER_JOINED, async () => {
            if (role !== 'host') return;
            await WebRTCService.createPeerConnection(true);
            unsubs.push(WebRTCService.onConnState(safe(setConnState)));
            unsubs.push(WebRTCService.onStats(safe(setStats)));

            localStream?.getTracks().forEach(t => WebRTCService.addTrack(t, localStream));
            const offer = await WebRTCService.createOffer();
            SignalingService.emit(MSG.OFFER, { offer });
        }));

        // CONTROLLER: receive offer → send answer
        unsubs.push(SignalingService.on(MSG.OFFER, async ({ offer }) => {
            if (role !== 'controller') return;
            await WebRTCService.createPeerConnection(false);
            unsubs.push(WebRTCService.onConnState(safe(setConnState)));
            unsubs.push(WebRTCService.onStats(safe(setStats)));
            WebRTCService.onRemoteTrack(stream => onRemoteStream?.(stream));

            const answer = await WebRTCService.createAnswer(offer);
            SignalingService.emit(MSG.ANSWER, { answer });
        }));

        // HOST: receive answer
        unsubs.push(SignalingService.on(MSG.ANSWER, async ({ answer }) => {
            if (role !== 'host') return;
            await WebRTCService.setAnswer(answer);
            safe(setConnState)('connected');
        }));

        // ICE exchange (both sides)
        unsubs.push(SignalingService.on(MSG.ICE_CANDIDATE, ({ candidate }) => {
            WebRTCService.addIceCandidate(candidate);
        }));

        unsubs.push(SignalingService.on(MSG.PEER_LEFT, () => safe(setConnState)('peer_left')));
        unsubs.push(SignalingService.on('disconnect', () => safe(setConnState)('disconnected')));
        unsubs.push(SignalingService.on('reconnect', () => safe(setConnState)('reconnecting')));

        return () => unsubs.forEach(u => u?.());
    }, [role, localStream, onRemoteStream, safe]);

    return { connState, stats, error, connect, disconnect };
}