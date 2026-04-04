require('dotenv').config(); // Abre la caja fuerte de las variables ocultas
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose'); // <-- El traductor de Base de Datos

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static('public'));

// --- 1. CONEXIÓN A LA BASE DE DATOS ---
const uri = process.env.MONGO_URI;

mongoose.connect(uri)
    .then(() => console.log("🟢 ¡Conectado a MongoDB! El cerebro está en línea."))
    .catch(err => console.error("🔴 Error conectando a MongoDB:", err));

// --- 2. EL "MOLDE" DE LOS PROYECTOS (SCHEMA) ---
// Así es como se guardará cada plantilla en la nube
const ProyectoSchema = new mongoose.Schema({
    nombre: String,          // Nombre del archivo (ej. "Mapa Mental")
    elementos: Array,        // Aquí guardaremos el JSON gigante de los dibujos
    fecha: { type: Date, default: Date.now }
});

// Creamos el modelo basado en el molde
const Proyecto = mongoose.model('Proyecto', ProyectoSchema);
// ----------------------------------------------


// Por ahora mantenemos esta variable en RAM para que tu pizarra actual 
// siga funcionando mientras terminamos de armar el sistema de archivos.
let historialDibujos = []; 
const PASSWORD_SALA = "12345";

io.use((socket, next) => {
    const password = socket.handshake.auth.password;
    if (password === PASSWORD_SALA) { return next(); }
    return next(new Error("Contraseña incorrecta"));
});

io.on('connection', (socket) => {
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

    socket.on('dibujar_laser', (datos) => {
        socket.broadcast.emit('dibujar_laser', datos);
    });

    socket.on('mover_cursor', (datos) => {
        socket.broadcast.emit('mover_cursor', { 
            id: socket.id, x: datos.x, y: datos.y, nombre: datos.nombre 
        });
    });

    socket.on('disconnect', () => {
        socket.broadcast.emit('borrar_cursor', socket.id);
    });
});

const PUERTO = process.env.PORT || 3000;
server.listen(PUERTO, () => console.log(`🚀 Servidor en puerto ${PUERTO}`));
