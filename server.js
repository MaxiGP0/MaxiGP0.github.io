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

app.use(express.json()); 
app.use(express.static('public'));

// --- 1. CONEXIÓN A LA BASE DE DATOS ---
const uri = process.env.MONGO_URI;
mongoose.connect(uri)
    .then(() => console.log("🟢 ¡Conectado a MongoDB! El cerebro está en línea."))
    .catch(err => console.error("🔴 Error conectando a MongoDB:", err));

// --- 2. EL "MOLDE" DE LAS SALAS ---
const ProyectoSchema = new mongoose.Schema({
    _id: String,             
    nombre: { type: String, default: 'Pizarra Sin Nombre' }, 
    elementos: { type: Array, default: [] }, 
    fecha: { type: Date, default: Date.now }
});
const Proyecto = mongoose.model('Proyecto', ProyectoSchema);

// --- 3. LA CONTRASEÑA MAESTRA ---
const PASSWORD_SALA = "test"; // <-- La subimos aquí para usarla en todo el archivo

// --- 4. LAS PUERTAS API PROTEGIDAS ---

// Leer (Cualquiera puede ver la lista)
app.get('/api/proyectos', async (req, res) => {
    try {
        const proyectos = await Proyecto.find({}, '_id nombre fecha').sort({ fecha: -1 });
        res.json(proyectos);
    } catch (error) { res.status(500).json({ error: 'Error al cargar' }); }
});

// Renombrar (PROTEGIDO)
app.put('/api/proyectos/:id', async (req, res) => {
    try {
        // El policía revisa la contraseña
        if (req.body.password !== PASSWORD_SALA) {
            return res.status(401).json({ error: 'Contraseña incorrecta' });
        }
        await Proyecto.findByIdAndUpdate(req.params.id, { nombre: req.body.nombre });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error al renombrar' }); }
});

// Borrar un proyecto (PROTEGIDO)
app.delete('/api/proyectos/:id', async (req, res) => {
    try {
        // El policía revisa la contraseña
        if (req.body.password !== PASSWORD_SALA) {
            return res.status(401).json({ error: 'Contraseña incorrecta' });
        }
        await Proyecto.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error al borrar' }); }
});

// --- 5. LÓGICA DE MULTIJUGADOR Y AUTOGUARDADO ---

io.use((socket, next) => {
    const { password, salaId } = socket.handshake.auth;
    if (password === PASSWORD_SALA && salaId) {
        socket.salaId = salaId;
        return next();
    }
    return next(new Error("Contraseña incorrecta o sin sala"));
});

io.on('connection', async (socket) => {
    const sala = socket.salaId;
    socket.join(sala);
    console.log(`👤 Usuario entró a la sala: ${sala}`);

    let proyecto = await Proyecto.findById(sala);
    if (!proyecto) { proyecto = await Proyecto.create({ _id: sala, elementos: [] }); }

    socket.emit('cargar_historial', proyecto.elementos);

    socket.on('dibujar', (datos) => socket.to(sala).emit('dibujar', datos));

    socket.on('sync_todo', async (nuevoHistorial) => {
        socket.to(sala).emit('cargar_historial', nuevoHistorial);
        await Proyecto.findByIdAndUpdate(sala, { elementos: nuevoHistorial, fecha: Date.now() });
    });

    socket.on('limpiar_todo', async () => {
        io.to(sala).emit('limpiar_todo');
        await Proyecto.findByIdAndUpdate(sala, { elementos: [] });
    });

    socket.on('dibujar_laser', (datos) => socket.to(sala).emit('dibujar_laser', datos));
    socket.on('mover_cursor', (datos) => socket.to(sala).emit('mover_cursor', { id: socket.id, x: datos.x, y: datos.y, nombre: datos.nombre }));
    socket.on('disconnect', () => socket.to(sala).emit('borrar_cursor', socket.id));
});

const PUERTO = process.env.PORT || 3000;
server.listen(PUERTO, () => console.log(`🚀 Servidor en puerto ${PUERTO}`));
