require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(express.json()); 
app.use(express.static('public'));

const uri = process.env.MONGO_URI;
mongoose.connect(uri)
    .then(() => console.log("🟢 ¡Conectado a MongoDB! El cerebro está en línea."))
    .catch(err => console.error("🔴 Error conectando a MongoDB:", err));

const UsuarioSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    fechaRegistro: { type: Date, default: Date.now }
});
const Usuario = mongoose.model('Usuario', UsuarioSchema);

const ProyectoSchema = new mongoose.Schema({
    _id: String,             
    nombre: { type: String, default: 'Pizarra Sin Nombre' }, 
    carpeta: { type: String, default: 'Principal' }, // NUEVO: Sistema de carpetas
    elementos: { type: Array, default: [] }, 
    propietarioId: { type: String }, 
    fecha: { type: Date, default: Date.now }
});
const Proyecto = mongoose.model('Proyecto', ProyectoSchema);

const LLAVE_SECRETA_JWT = process.env.JWT_SECRET || 'mi_llave_secreta_temporal_123';

app.post('/api/auth/registro', async (req, res) => {
    try {
        const { nombre, email, password } = req.body;
        if (await Usuario.findOne({ email })) return res.status(400).json({ error: 'El correo ya existe.' });
        const salt = await bcrypt.genSalt(10);
        const passwordEncriptada = await bcrypt.hash(password, salt);
        await Usuario.create({ nombre, email, password: passwordEncriptada });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error al registrar.' }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const usuario = await Usuario.findOne({ email });
        if (!usuario) return res.status(400).json({ error: 'Datos incorrectos.' });
        const valida = await bcrypt.compare(password, usuario.password);
        if (!valida) return res.status(400).json({ error: 'Datos incorrectos.' });
        const token = jwt.sign({ id: usuario._id, nombre: usuario.nombre }, LLAVE_SECRETA_JWT, { expiresIn: '7d' });
        res.json({ success: true, token, usuario: { id: usuario._id, nombre: usuario.nombre } });
    } catch (error) { res.status(500).json({ error: 'Error al iniciar sesión.' }); }
});

const verificarToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'Acceso denegado' });
    try {
        const verificado = jwt.verify(token.split(" ")[1], LLAVE_SECRETA_JWT);
        req.usuario = verificado;
        next();
    } catch (error) { res.status(400).json({ error: 'Token inválido' }); }
};

app.get('/api/proyectos', verificarToken, async (req, res) => {
    try {
        const proyectos = await Proyecto.find({ propietarioId: req.usuario.id }, '_id nombre carpeta fecha').sort({ fecha: -1 });
        res.json(proyectos);
    } catch (error) { res.status(500).json({ error: 'Error al cargar' }); }
});

app.put('/api/proyectos/:id', verificarToken, async (req, res) => {
    try {
        const p = await Proyecto.findById(req.params.id);
        if (p.propietarioId !== req.usuario.id) return res.status(403).json({ error: 'No eres el dueño' });
        
        // Permite actualizar nombre y carpeta
        const updates = {};
        if (req.body.nombre) updates.nombre = req.body.nombre;
        if (req.body.carpeta) updates.carpeta = req.body.carpeta;

        await Proyecto.findByIdAndUpdate(req.params.id, updates);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error al editar' }); }
});

app.delete('/api/proyectos/:id', verificarToken, async (req, res) => {
    try {
        const p = await Proyecto.findById(req.params.id);
        if (p.propietarioId !== req.usuario.id) return res.status(403).json({ error: 'No eres el dueño' });
        await Proyecto.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error al borrar' }); }
});

io.use((socket, next) => {
    const { token, salaId } = socket.handshake.auth;
    if (!token || !salaId) return next(new Error("Sin Pase VIP"));
    try {
        const decoded = jwt.verify(token, LLAVE_SECRETA_JWT);
        socket.usuario = decoded; 
        socket.salaId = salaId;
        return next();
    } catch(err) { return next(new Error("Pase VIP inválido")); }
});

io.on('connection', async (socket) => {
    const sala = socket.salaId;
    let proyecto = await Proyecto.findById(sala);
    
    if (!proyecto) { proyecto = await Proyecto.create({ _id: sala, elementos: [], propietarioId: socket.usuario.id, carpeta: 'Principal' }); }

    const esElDueño = proyecto.propietarioId === socket.usuario.id;

    if (esElDueño) {
        socket.join(sala);
        socket.emit('acceso_permitido', proyecto.elementos);
    } else {
        socket.join(socket.id); 
        socket.emit('esperando_aprobacion');
        socket.to(sala).emit('alguien_quiere_entrar', { guestId: socket.id, nombre: socket.usuario.nombre });
    }

    socket.on('responder_acceso', async ({ guestId, aprobado }) => {
        const p = await Proyecto.findById(sala);
        if (p.propietarioId !== socket.usuario.id) return; 
        const guestSocket = io.sockets.sockets.get(guestId);
        if (!guestSocket) return;

        if (aprobado) {
            guestSocket.join(sala);
            guestSocket.emit('acceso_permitido', p.elementos);
        } else {
            guestSocket.emit('acceso_denegado');
        }
    });

    socket.on('dibujar', async (datos) => {
        socket.to(sala).emit('dibujar', datos);
        await Proyecto.findByIdAndUpdate(sala, { $push: { elementos: datos }, fecha: Date.now() });
    });

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
