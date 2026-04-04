require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

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

// --- 2. EL "MOLDE" DE LAS SALAS ---
// Ahora cada sala es un documento en la base de datos
const ProyectoSchema = new mongoose.Schema({
    _id: String,             // El ID será el nombre de la sala (ej: "x8a9pq")
    elementos: { type: Array, default: [] }, // El JSON de los dibujos
    fecha: { type: Date, default: Date.now }
});
const Proyecto = mongoose.model('Proyecto', ProyectoSchema);

// --- 3. LÓGICA DE MULTIJUGADOR Y AUTOGUARDADO ---
const PASSWORD_SALA = "test";

// Filtro de seguridad: Exigimos contraseña y nombre de sala
io.use((socket, next) => {
    const { password, salaId } = socket.handshake.auth;
    if (password === PASSWORD_SALA && salaId) {
        socket.salaId = salaId; // Le pegamos una etiqueta al usuario con su sala
        return next();
    }
    return next(new Error("Contraseña incorrecta o sin sala"));
});

io.on('connection', async (socket) => {
    const sala = socket.salaId;
    
    // 1. Metemos al usuario en su "habitación" privada
    socket.join(sala);
    console.log(`👤 Usuario entró a la sala: ${sala}`);

    // 2. Buscamos si esta sala ya existía en la Base de Datos
    let proyecto = await Proyecto.findById(sala);
    if (!proyecto) {
        // Si es una sala nueva, la creamos en blanco en la base de datos
        proyecto = await Proyecto.create({ _id: sala, elementos: [] });
    }

    // 3. Le enviamos los dibujos guardados SOLO a este usuario
    socket.emit('cargar_historial', proyecto.elementos);

    // 4. Cuando dibuja, retransmitimos SOLO a los que están en su misma sala
    socket.on('dibujar', (datos) => {
        socket.to(sala).emit('dibujar', datos);
    });

    // 5. Sincronización y AUTOGUARDADO MÁGICO en MongoDB
    socket.on('sync_todo', async (nuevoHistorial) => {
        socket.to(sala).emit('cargar_historial', nuevoHistorial);
        
        // Guardamos en el disco duro de la nube silenciosamente
        await Proyecto.findByIdAndUpdate(sala, { 
            elementos: nuevoHistorial, 
            fecha: Date.now() 
        });
    });

    // 6. Si limpian la pizarra, borramos los datos en MongoDB
    socket.on('limpiar_todo', async () => {
        io.to(sala).emit('limpiar_todo');
        await Proyecto.findByIdAndUpdate(sala, { elementos: [] });
    });

    // El láser y los cursores no se guardan en la BD, solo se retransmiten en la sala
    socket.on('dibujar_laser', (datos) => socket.to(sala).emit('dibujar_laser', datos));
    socket.on('mover_cursor', (datos) => {
        socket.to(sala).emit('mover_cursor', { id: socket.id, x: datos.x, y: datos.y, nombre: datos.nombre });
    });

    socket.on('disconnect', () => socket.to(sala).emit('borrar_cursor', socket.id));
});

const PUERTO = process.env.PORT || 3000;
server.listen(PUERTO, () => console.log(`🚀 Servidor en puerto ${PUERTO}`));
