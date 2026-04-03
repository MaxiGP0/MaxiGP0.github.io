// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
// Configuramos CORS para evitar problemas de conexión
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static('public'));

let historialDibujos = [];

io.on('connection', (socket) => {
    console.log('🟢 Usuario conectado: ' + socket.id);

    // Enviar historial al nuevo usuario
    socket.emit('cargar_historial', historialDibujos);

    // Recibir nuevo objeto y retransmitir
    socket.on('dibujar', (datos) => {
        historialDibujos.push(datos);
        socket.broadcast.emit('dibujar', datos);
    });

    // Recibir actualización de todo el tablero (para mover/resize/borrar)
    socket.on('sync_todo', (nuevoHistorial) => {
        historialDibujos = nuevoHistorial;
        socket.broadcast.emit('cargar_historial', historialDibujos);
    });

    // Recibir orden de limpiar todo
    socket.on('limpiar_todo', () => {
        historialDibujos = [];
        // Avisar a TODOS, incluido el que mandó la orden
        io.emit('limpiar_todo');
    });

    socket.on('mover_cursor', (datos) => {
        socket.broadcast.emit('mover_cursor', { id: socket.id, x: datos.x, y: datos.y });
    });

    socket.on('disconnect', () => {
        console.log('🔴 Usuario desconectado: ' + socket.id);
        socket.broadcast.emit('borrar_cursor', socket.id);
    });
});

const PUERTO = process.env.PORT || 3000;
server.listen(PUERTO, () => {
    console.log(`🚀 Servidor multijugador en http://localhost:${PUERTO}`);
});
