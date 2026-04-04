require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

// NUEVO: Motores de Seguridad
const bcrypt = require('bcryptjs');     // Para encriptar contraseñas
const jwt = require('jsonwebtoken');    // Para crear el pase VIP de sesión

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

// --- 2. LOS MOLDES (SCHEMAS) DE LA BASE DE DATOS ---

// NUEVO MOLDE: Usuarios
const UsuarioSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    email: { type: String, required: true, unique: true }, // El email no se puede repetir
    password: { type: String, required: true },            // Aquí guardaremos la clave encriptada
    fechaRegistro: { type: Date, default: Date.now }
});
const Usuario = mongoose.model('Usuario', UsuarioSchema);

// MOLDE ACTUALIZADO: Proyectos (Ahora con dueño)
const ProyectoSchema = new mongoose.Schema({
    _id: String,             
    nombre: { type: String, default: 'Pizarra Sin Nombre' }, 
    elementos: { type: Array, default: [] }, 
    propietarioId: { type: String }, // <-- NUEVO: Guardaremos el ID del dueño aquí
    fecha: { type: Date, default: Date.now }
});
const Proyecto = mongoose.model('Proyecto', ProyectoSchema);


// --- 3. NUEVAS PUERTAS DE SEGURIDAD (LOGIN / REGISTRO) ---
const LLAVE_SECRETA_JWT = process.env.JWT_SECRET || 'mi_llave_secreta_temporal_123'; // La llave para fabricar los pases VIP

// Puerta para Registrarse
app.post('/api/auth/registro', async (req, res) => {
    try {
        const { nombre, email, password } = req.body;

        // 1. Revisamos si el email ya existe
        const usuarioExistente = await Usuario.findOne({ email: email });
        if (usuarioExistente) {
            return res.status(400).json({ error: 'Ese correo ya está registrado.' });
        }

        // 2. Encriptamos la contraseña (le damos 10 vueltas de cifrado)
        const salt = await bcrypt.genSalt(10);
        const passwordEncriptada = await bcrypt.hash(password, salt);

        // 3. Creamos al usuario en la base de datos
        const nuevoUsuario = await Usuario.create({
            nombre: nombre,
            email: email,
            password: passwordEncriptada
        });

        res.json({ success: true, mensaje: 'Usuario creado correctamente.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al registrar usuario.' });
    }
});

// Puerta para Iniciar Sesión
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Buscamos al usuario por su email
        const usuario = await Usuario.findOne({ email: email });
        if (!usuario) {
            return res.status(400).json({ error: 'Correo o contraseña incorrectos.' });
        }

        // 2. Comparamos la contraseña que escribió con la encriptada
        const contraseñaValida = await bcrypt.compare(password, usuario.password);
        if (!contraseñaValida) {
            return res.status(400).json({ error: 'Correo o contraseña incorrectos.' });
        }

        // 3. ¡Todo correcto! Fabricamos un pase VIP (Token)
        // Este pase dice "El portador es X usuario" y tiene la firma del servidor
        const paseVIP = jwt.sign(
            { id: usuario._id, nombre: usuario.nombre }, 
            LLAVE_SECRETA_JWT, 
            { expiresIn: '7d' } // El pase caduca en 7 días
        );

        res.json({ 
            success: true, 
            token: paseVIP, 
            usuario: { id: usuario._id, nombre: usuario.nombre } 
        });

    } catch (error) {
        res.status(500).json({ error: 'Error al iniciar sesión.' });
    }
});


// --- 4. LAS PUERTAS API (PARA EL DASHBOARD) ---
// (Por ahora las dejamos igual para no romper tu web, mañana las protegeremos)

app.get('/api/proyectos', async (req, res) => {
    try {
        const proyectos = await Proyecto.find({}, '_id nombre fecha').sort({ fecha: -1 });
        res.json(proyectos);
    } catch (error) { res.status(500).json({ error: 'Error al cargar' }); }
});

app.put('/api/proyectos/:id', async (req, res) => {
    try {
        await Proyecto.findByIdAndUpdate(req.params.id, { nombre: req.body.nombre });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error al renombrar' }); }
});

app.delete('/api/proyectos/:id', async (req, res) => {
    try {
        await Proyecto.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error al borrar' }); }
});


// --- 5. LÓGICA DE MULTIJUGADOR Y AUTOGUARDADO ---
// (Por ahora se queda igual)

const PASSWORD_SALA = "12345";

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
