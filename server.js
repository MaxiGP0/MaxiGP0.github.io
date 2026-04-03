const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Le decimos al servidor que sirva los archivos de la carpeta "public"
app.use(express.static('public'));

// Guardamos el historial de líneas para los que entran tarde
let historialDibujos = [];

io.on('connection', (socket) => {
    console.log('🟢 Un usuario se ha conectado: ' + socket.id);

    // Cuando alguien entra, le enviamos todo el historial
    socket.emit('cargar_historial', historialDibujos);

    // Cuando recibimos un trazo, lo guardamos y lo reenviamos a todos
    socket.on('dibujar', (datos) => {
        historialDibujos.push(datos);
        socket.broadcast.emit('dibujar', datos); // broadcast = enviar a todos menos al que dibujó
    });

    // Cuando alguien mueve el ratón, reenviamos su posición
    socket.on('mover_cursor', (datos) => {
        socket.broadcast.emit('mover_cursor', { id: socket.id, x: datos.x, y: datos.y });
    });

    socket.on('disconnect', () => {
        console.log('🔴 Usuario desconectado: ' + socket.id);
        socket.broadcast.emit('borrar_cursor', socket.id);
    });
});

const PUERTO = 3000;
server.listen(PUERTO, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PUERTO}`);
});
