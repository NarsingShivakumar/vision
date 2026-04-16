import {
    RTCPeerConnection,
    RTCIceCandidate,
    RTCSessionDescription,
} from 'react-native-webrtc';
import { SignalingService } from './SignalingService';
import { MSG } from '../utils/constants';

// Offline LAN — no STUN/TURN. ICE candidates stay on the local subnet.
const RTC_CONFIG = { iceServers: [], iceTransportPolicy: 'all' };

let pc = null;
let dc = null;           // DataChannel for control messages
let statsTimer = null;

const dcCbs = new Set();
const trackCbs = new Set();
const stateCbs = new Set();
const statsCbs = new Set();

export const WebRTCService = {
    async createPeerConnection(isInitiator) {
        pc = new RTCPeerConnection(RTC_CONFIG);

        pc.onicecandidate = ({ candidate }) => {
            if (candidate) SignalingService.emit(MSG.ICE_CANDIDATE, { candidate });
        };

        pc.onconnectionstatechange = () =>
            stateCbs.forEach(cb => cb(pc.connectionState));

        pc.ontrack = ev =>
            trackCbs.forEach(cb => cb(ev.streams[0]));

        if (isInitiator) {
            dc = pc.createDataChannel('control', { ordered: true });
            _hookDC(dc);
        } else {
            pc.ondatachannel = ev => { dc = ev.channel; _hookDC(dc); };
        }

        _startStats();
        return pc;
    },

    addTrack(track, stream) { pc?.addTrack(track, stream); },

    async createOffer() {
        const offer = await pc.createOffer({ offerToReceiveVideo: false });
        await pc.setLocalDescription(offer);
        return offer;
    },

    async createAnswer(offerSdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        return answer;
    },

    async setAnswer(answerSdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(answerSdp));
    },

    async addIceCandidate(candidate) {
        try { await pc?.addIceCandidate(new RTCIceCandidate(candidate)); } catch { }
    },

    sendControl(msg) {
        if (dc?.readyState === 'open') dc.send(JSON.stringify(msg));
    },

    onControlMessage(cb) { dcCbs.add(cb); return () => dcCbs.delete(cb); },
    onRemoteTrack(cb) { trackCbs.add(cb); return () => trackCbs.delete(cb); },
    onConnState(cb) { stateCbs.add(cb); return () => stateCbs.delete(cb); },
    onStats(cb) { statsCbs.add(cb); return () => statsCbs.delete(cb); },

    getConnState: () => pc?.connectionState ?? 'closed',

    close() {
        _stopStats();
        dc?.close(); pc?.close();
        dc = null; pc = null;
        dcCbs.clear(); trackCbs.clear(); stateCbs.clear(); statsCbs.clear();
    },
};

function _hookDC(channel) {
    channel.onmessage = ev => {
        try { dcCbs.forEach(cb => cb(JSON.parse(ev.data))); } catch { }
    };
}

let _prevBytes = 0, _prevTs = Date.now();
function _startStats() {
    _stopStats();
    statsTimer = setInterval(async () => {
        if (!pc) return;
        try {
            const reports = await pc.getStats();
            let bytesReceived = 0, bytesSent = 0, fps = 0, rtt = 0;
            reports.forEach(r => {
                if (r.type === 'inbound-rtp' && r.kind === 'video') { bytesReceived = r.bytesReceived || 0; fps = r.framesPerSecond || 0; }
                if (r.type === 'outbound-rtp' && r.kind === 'video') { bytesSent = r.bytesSent || 0; }
                if (r.type === 'candidate-pair' && r.state === 'succeeded') rtt = Math.round((r.currentRoundTripTime || 0) * 1000);
            });
            const now = Date.now();
            const dt = (now - _prevTs) / 1000;
            const bytes = bytesReceived || bytesSent;
            const bitrate = dt > 0 ? Math.round(((bytes - _prevBytes) * 8) / dt / 1000) : 0;
            _prevBytes = bytes; _prevTs = now;
            statsCbs.forEach(cb => cb({ bitrate, fps: Math.round(fps), rtt }));
        } catch { }
    }, 1000);
}
function _stopStats() { if (statsTimer) { clearInterval(statsTimer); statsTimer = null; } }