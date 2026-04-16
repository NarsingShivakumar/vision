const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode() {
    let code = '';
    for (let i = 0; i < 6; i++) code += CHARS[Math.floor(Math.random() * CHARS.length)];
    return code;
}

export function formatCode(raw) {
    return (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}