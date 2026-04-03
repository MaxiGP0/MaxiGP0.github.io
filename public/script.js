const socket = io(); // Nos conectamos al servidor

const canvas = document.getElementById('pizarra');
const ctx = canvas.getContext('2d');

// Ajustar el canvas al tamaño de la pantalla
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Variables de estado
let dibujando = false;
let colorActual = '#000000';
let grosorActual = 3;
let modo = 'pen'; // 'pen' o 'erase'

let xAnterior = 0;
let yAnterior = 0;

// Configuración de herramientas
document.getElementById('color-picker').addEventListener('input', (e) => colorActual = e.target.value);
document.getElementById('width-slider').addEventListener('input', (e) => grosorActual = e.target.value);

document.getElementById('btn-pen').addEventListener('click', (e) => {
    modo = 'pen';
    e.target.classList.add('active');
    document.getElementById('btn-erase').classList.remove('active');
});

document.getElementById('btn-erase').addEventListener('click', (e) => {
    modo = 'erase';
    e.target.classList.add('active');
    document.getElementById('btn-pen').classList.remove('active');
});

// Función central para trazar una línea
function trazarLinea(x0, y0, x1, y1, color, grosor, esBorrador) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = esBorrador ? 'white' : color;
    ctx.lineWidth = grosor;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.closePath();
}

// ---- EVENTOS DEL MOUSE (MI DIBUJO) ----
canvas.addEventListener('mousedown', (e) => {
    dibujando = true;
    xAnterior = e.clientX;
    yAnterior = e.clientY;
});

canvas.addEventListener('mousemove', (e) => {
    // 1. Enviar siempre mi posición para el cursor fantasma
    socket.emit('mover_cursor', { x: e.clientX, y: e.clientY });

    // 2. Si estoy dibujando, trazar y enviar la línea
    if (dibujando) {
        const xActual = e.clientX;
        const yActual = e.clientY;
        const esBorrador = (modo === 'erase');

        // Dibujo en mi pantalla
        trazarLinea(xAnterior, yAnterior, xActual, yActual, colorActual, grosorActual, esBorrador);

        // Envío los datos de esta línea al servidor
        socket.emit('dibujar', {
            x0: xAnterior, y0: yAnterior,
            x1: xActual, y1: yActual,
            color: colorActual,
            grosor: grosorActual,
            borrador: esBorrador
        });

        xAnterior = xActual;
        yAnterior = yActual;
    }
});

canvas.addEventListener('mouseup', () => dibujando = false);
canvas.addEventListener('mouseout', () => dibujando = false);


// ---- RECEPCIÓN DEL SERVIDOR (MULTIJUGADOR) ----

// Cuando entro, el servidor me manda lo que ya estaba dibujado
socket.on('cargar_historial', (historial) => {
    historial.forEach(linea => {
        trazarLinea(linea.x0, linea.y0, linea.x1, linea.y1, linea.color, linea.grosor, linea.borrador);
    });
});

// Cuando alguien dibuja en tiempo real
socket.on('dibujar', (datos) => {
    trazarLinea(datos.x0, datos.y0, datos.x1, datos.y1, datos.color, datos.grosor, datos.borrador);
});

// ---- CURSORES FANTASMA ----
const contenedorCursores = document.getElementById('cursores');
const cursoresActivos = {};

socket.on('mover_cursor', (datos) => {
    // Si el cursor de este usuario no existe, lo creamos
    if (!cursoresActivos[datos.id]) {
        const nuevoCursor = document.createElement('div');
        nuevoCursor.classList.add('cursor-fantasma');
        contenedorCursores.appendChild(nuevoCursor);
        cursoresActivos[datos.id] = nuevoCursor;
    }
    // Movemos el div a la posición X e Y
    cursoresActivos[datos.id].style.left = datos.x + 'px';
    cursoresActivos[datos.id].style.top = datos.y + 'px';
});

// Si un usuario se va, borramos su punto rojo
socket.on('borrar_cursor', (id) => {
    if (cursoresActivos[id]) {
        cursoresActivos[id].remove();
        delete cursoresActivos[id];
    }
});