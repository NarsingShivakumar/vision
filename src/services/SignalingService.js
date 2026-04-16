import { io } from 'socket.io-client';
import { MSG } from '../utils/constants';

let socket = null;
const listeners = new Map();

export const SignalingService = {
    connect(serverUrl) {
        return new Promise((resolve, reject) => {
            socket = io(serverUrl, {
                transports: ['websocket'],
                reconnection: true,
                reconnectionDelay: 1500,
                reconnectionAttempts: 8,
                timeout: 6000,
            });
            socket.on('connect', () => resolve(socket.id));
            socket.on('connect_error', err => reject(err));

            [
                ...Object.values(MSG),
                'disconnect', 'reconnect', 'reconnect_attempt',
            ].forEach(event => {
                socket.on(event, data => _fire(event, data));
            });
        });
    },

    disconnect() {
        socket?.disconnect();
        socket = null;
    },

    emit(event, data) {
        if (socket?.connected) socket.emit(event, data);
    },

    on(event, cb) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(cb);
        return () => listeners.get(event)?.delete(cb);
    },

    isConnected: () => socket?.connected ?? false,
};

function _fire(event, data) {
    listeners.get(event)?.forEach(cb => cb(data));
}