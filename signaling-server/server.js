// ScreenCast Signaling Server — runs locally on LAN, no internet needed
// Run: node server.js
// Setup: cd signaling-server && npm install socket.io && node server.js

const { Server } = require('socket.io');
const http = require('http');

const PORT = 3838;
const server = http.createServer((req, res) => {
    res.writeHead(200); res.end('ScreenCast Signaling Server OK\n');
});

const io = new Server(server, { cors: { origin: '*' } });

// rooms: roomCode -> Set of socketIds
const rooms = new Map();

io.on('connection', socket => {
    console.log('[+] Connected:', socket.id);

    socket.on('join_room', ({ roomCode, role }) => {
        socket.join(roomCode);
        socket.data.roomCode = roomCode;
        socket.data.role = role;

        if (!rooms.has(roomCode)) rooms.set(roomCode, new Set());
        rooms.get(roomCode).add(socket.id);

        socket.emit('room_joined', { roomCode, role, socketId: socket.id });
        socket.to(roomCode).emit('peer_joined', { role, socketId: socket.id });
        console.log(`[room:${roomCode}] ${role} joined (${socket.id})`);
    });

    socket.on('offer', data => socket.to(socket.data.roomCode).emit('offer', data));
    socket.on('answer', data => socket.to(socket.data.roomCode).emit('answer', data));
    socket.on('ice_candidate', data => socket.to(socket.data.roomCode).emit('ice_candidate', data));

    socket.on('disconnect', () => {
        const { roomCode } = socket.data;
        if (roomCode) {
            rooms.get(roomCode)?.delete(socket.id);
            if (rooms.get(roomCode)?.size === 0) rooms.delete(roomCode);
            socket.to(roomCode).emit('peer_left', { socketId: socket.id });
            console.log(`[-] ${socket.id} left room ${roomCode}`);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ ScreenCast Signaling Server running on port ${PORT}`);
    console.log(`   Open http://<this-device-ip>:${PORT} to verify\n`);
});