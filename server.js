const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static('public'));

let historialDibujos = [];

// 🔐 LA CONTRASEÑA SECRETA DE TU SALA
const PASSWORD_SALA = "maxigp01"; // <-- CÁMBIALA POR LA QUE TÚ QUIERAS

// EL GUARDIA DE SEGURIDAD (Filtro antes de conectar)
io.use((socket, next) => {
    const password = socket.handshake.auth.password;
    if (password === PASSWORD_SALA) {
        return next(); // Contraseña correcta, pasa.
    }
    return next(new Error("Contraseña incorrecta")); // Contraseña mala, lo patea.
});

io.on('connection', (socket) => {
    // Si llegó hasta aquí, es porque puso bien la contraseña
    socket.emit('cargar_historial', historialDibujos);

    socket.on('dibujar', (datos) => {
        historialDibujos.push(datos);
        socket.broadcast.emit('dibujar', datos);
    });

    socket.on('sync_todo', (nuevoHistorial) => {
        historialDibujos = nuevoHistorial;
        socket.broadcast.emit('cargar_historial', historialDibujos);
    });

    socket.on('limpiar_todo', () => {
        historialDibujos = [];
        io.emit('limpiar_todo');
    });

    socket.on('mover_cursor', (datos) => {
        socket.broadcast.emit('mover_cursor', { id: socket.id, x: datos.x, y: datos.y });
    });

    socket.on('disconnect', () => {
        socket.broadcast.emit('borrar_cursor', socket.id);
    });
});

const PUERTO = process.env.PORT || 3000;
server.listen(PUERTO, () => {
    console.log(`🚀 Servidor en puerto ${PUERTO}`);
});
