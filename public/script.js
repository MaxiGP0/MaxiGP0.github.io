const socket = io();
const canvas = document.getElementById('pizarra');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let modo = 'select';
let dibujando = false;
let elementos = []; // Aquí guardaremos todos los objetos (rects, fotos, etc.)
let elementoActual = null;
let seleccionado = null;

// Configuración de herramientas
const controls = {
    color: document.getElementById('color-picker'),
    width: document.getElementById('width-slider')
};

// --- CAMBIO DE MODOS ---
document.querySelectorAll('#toolbar button[id^="btn-"]').forEach(btn => {
    btn.addEventListener('click', () => {
        if(btn.id === 'btn-export') { exportarJPG(); return; }
        if(btn.id === 'btn-image') { subirImagen(); return; }
        
        document.querySelectorAll('#toolbar button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        modo = btn.id.replace('btn-', '');
    });
});

// --- LÓGICA DE DIBUJO Y OBJETOS ---
canvas.addEventListener('mousedown', e => {
    const { x, y } = getPos(e);
    
    if (modo === 'select') {
        seleccionado = elementos.findLast(el => x > el.x && x < el.x + el.w && y > el.y && y < el.y + el.h);
    } else if (modo !== 'erase') {
        dibujando = true;
        elementoActual = {
            id: Math.random().toString(36).substr(2, 9),
            type: modo,
            x: x, y: y, w: 0, h: 0,
            color: controls.color.value,
            width: parseInt(controls.width.value),
            points: modo === 'pen' ? [{x, y}] : []
        };
    }
});

canvas.addEventListener('mousemove', e => {
    const { x, y } = getPos(e);
    socket.emit('mover_cursor', { x, y });

    if (dibujando && elementoActual) {
        if (modo === 'pen') {
            elementoActual.points.push({x, y});
        } else {
            elementoActual.w = x - elementoActual.x;
            elementoActual.h = y - elementoActual.y;
        }
        render();
    }
    
    if (modo === 'select' && seleccionado && e.buttons === 1) {
        seleccionado.x = x - seleccionado.w / 2;
        seleccionado.y = y - seleccionado.h / 2;
        render();
    }
});

canvas.addEventListener('mouseup', () => {
    if (dibujando && elementoActual) {
        elementos.push(elementoActual);
        socket.emit('dibujar', elementoActual);
    }
    dibujando = false;
    elementoActual = null;
});

// --- RENDERIZADO ---
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    [...elementos, elementoActual].forEach(el => {
        if (!el) return;
        ctx.strokeStyle = el.color;
        ctx.lineWidth = el.width;
        ctx.lineCap = 'round';

        if (el.type === 'pen') {
            ctx.beginPath();
            el.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
            ctx.stroke();
        } else if (el.type === 'rect') {
            ctx.strokeRect(el.x, el.y, el.w, el.h);
        } else if (el.type === 'ellipse') {
            ctx.beginPath();
            ctx.ellipse(el.x + el.w/2, el.y + el.h/2, Math.abs(el.w/2), Math.abs(el.h/2), 0, 0, Math.PI*2);
            ctx.stroke();
        } else if (el.type === 'image' && el.imgObj) {
            ctx.drawImage(el.imgObj, el.x, el.y, el.w, el.h);
        }
    });
}

// --- FUNCIONES EXTRA ---
function getPos(e) { return { x: e.clientX, y: e.clientY }; }

function subirImagen() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = e => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const item = { type: 'image', x: 100, y: 100, w: img.width/2, h: img.height/2, src: img.src };
                elementos.push(item);
                item.imgObj = img;
                socket.emit('dibujar', item);
                render();
            };
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

function exportarJPG() {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tCtx = tempCanvas.getContext('2d');
    tCtx.fillStyle = "white";
    tCtx.fillRect(0,0, tempCanvas.width, tempCanvas.height);
    tCtx.drawImage(canvas, 0, 0);
    const link = document.createElement('a');
    link.download = 'mi-dibujo.jpg';
    link.href = tempCanvas.toDataURL('image/jpeg', 0.9);
    link.click();
}

// Red (Sincronización)
socket.on('dibujar', (obj) => {
    if (obj.type === 'image') {
        const img = new Image();
        img.src = obj.src;
        img.onload = () => { obj.imgObj = img; elementos.push(obj); render(); };
    } else {
        elementos.push(obj);
        render();
    }
});

socket.on('cargar_historial', (h) => {
    h.forEach(el => {
        if (el.type === 'image') {
            const img = new Image();
            img.src = el.src;
            img.onload = () => { el.imgObj = img; elementos.push(el); render(); };
        } else {
            elementos.push(el);
        }
    });
    setTimeout(render, 500);
});
