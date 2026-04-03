const socket = io();
const canvas = document.getElementById('pizarra');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let modo = 'select';
let elementos = [];
let dibujando = false;
let seleccionado = null;
let elementoActual = null;

// Cámara (Para el PAN)
let camera = { x: 0, y: 0 };
let isPanning = false;
let startPan = { x: 0, y: 0 };

const controls = {
    color: document.getElementById('color-picker'),
    btnSave: document.getElementById('btn-save')
};

// --- CONFIGURACIÓN DE BOTONES ---
document.querySelectorAll('#toolbar button[id^="btn-"]').forEach(btn => {
    btn.addEventListener('click', () => {
        if(btn.id === 'btn-export') { exportarJPG(); return; }
        if(btn.id === 'btn-image') { subirImagen(); return; }
        if(btn.id === 'btn-save') { guardarLocal(); return; }
        
        document.querySelectorAll('#toolbar button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        modo = btn.id.replace('btn-', '');
    });
});

// --- LÓGICA DE COORDENADAS (Traducir pantalla a mundo real) ---
function getMousePos(e) {
    const t = e.touches ? e.touches[0] : e;
    return { 
        x: t.clientX - camera.x, 
        y: t.clientY - camera.y,
        rawX: t.clientX,
        rawY: t.clientY
    };
}

// --- EVENTOS (Móvil y PC) ---
const startEvent = e => {
    const pos = getMousePos(e);
    
    if (modo === 'pan' || (e.button === 1)) {
        isPanning = true;
        startPan = { x: pos.rawX - camera.x, y: pos.rawY - camera.y };
        return;
    }

    if (modo === 'select') {
        seleccionado = elementos.findLast(el => 
            pos.x > el.x && pos.x < el.x + el.w && pos.y > el.y && pos.y < el.y + el.h);
    } else if (modo === 'text') {
        const txt = prompt("Escribe tu texto:");
        if(txt) {
            const nuevoText = { type: 'text', x: pos.x, y: pos.y, text: txt, color: controls.color.value, w: 100, h: 30 };
            elementos.push(nuevoText);
            socket.emit('dibujar', nuevoText);
            render();
        }
    } else {
        dibujando = true;
        elementoActual = {
            id: Math.random().toString(36).substr(2, 9),
            type: modo, x: pos.x, y: pos.y, w: 0, h: 0,
            color: controls.color.value, points: []
        };
    }
};

const moveEvent = e => {
    const pos = getMousePos(e);
    socket.emit('mover_cursor', { x: pos.x, y: pos.y });

    if (isPanning) {
        camera.x = pos.rawX - startPan.x;
        camera.y = pos.rawY - startPan.y;
        render();
        return;
    }

    if (dibujando && elementoActual) {
        if (modo === 'pen') {
            elementoActual.points.push({ x: pos.x, y: pos.y });
        } else {
            elementoActual.w = pos.x - elementoActual.x;
            elementoActual.h = pos.y - elementoActual.y;
        }
        render();
    }

    if (modo === 'select' && seleccionado && (e.buttons === 1 || e.touches)) {
        // Mover o Redimensionar simple (esquina inferior derecha)
        const distEscena = 20;
        if (pos.x > seleccionado.x + seleccionado.w - distEscena && pos.y > seleccionado.y + seleccionado.h - distEscena) {
            seleccionado.w = pos.x - seleccionado.x;
            seleccionado.h = pos.y - seleccionado.y;
        } else {
            seleccionado.x = pos.x - seleccionado.w / 2;
            seleccionado.y = pos.y - seleccionado.h / 2;
        }
        render();
    }
};

const endEvent = () => {
    if (dibujando && elementoActual) {
        elementos.push(elementoActual);
        socket.emit('dibujar', elementoActual);
    }
    if (isPanning || dibujando || seleccionado) socket.emit('sync_todo', elementos);
    dibujando = isPanning = false;
    elementoActual = null;
};

canvas.addEventListener('mousedown', startEvent);
window.addEventListener('mousemove', moveEvent);
window.addEventListener('mouseup', endEvent);

canvas.addEventListener('touchstart', e => { e.preventDefault(); startEvent(e); }, {passive: false});
window.addEventListener('touchmove', e => { e.preventDefault(); moveEvent(e); }, {passive: false});
window.addEventListener('touchend', endEvent);

// --- RENDERIZADO ---
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(camera.x, camera.y);

    // Fondo Cuadriculado Infinito
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 1;
    const gridSize = 40;
    const startX = -camera.x - ((-camera.x) % gridSize);
    const startY = -camera.y - ((-camera.y) % gridSize);
    for (let x = startX; x < canvas.width - camera.x; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, -camera.y); ctx.lineTo(x, canvas.height - camera.y); ctx.stroke();
    }
    for (let y = startY; y < canvas.height - camera.y; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(-camera.x, y); ctx.lineTo(canvas.width - camera.x, y); ctx.stroke();
    }

    [...elementos, elementoActual].forEach(el => {
        if (!el) return;
        ctx.strokeStyle = el.color; ctx.fillStyle = el.color; ctx.lineWidth = 3;

        if (el.type === 'pen') {
            ctx.beginPath();
            el.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
            ctx.stroke();
        } else if (el.type === 'rect') {
            ctx.strokeRect(el.x, el.y, el.w, el.h);
        } else if (el.type === 'text') {
            ctx.font = "20px Arial";
            ctx.fillText(el.text, el.x, el.y + 20);
        } else if (el.type === 'image' && el.imgObj) {
            ctx.drawImage(el.imgObj, el.x, el.y, el.w, el.h);
        }

        if (modo === 'select' && el === seleccionado) {
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(el.x - 5, el.y - 5, el.w + 10, el.h + 10);
            ctx.setLineDash([]);
            ctx.fillStyle = "blue";
            ctx.fillRect(el.x + el.w - 5, el.y + el.h - 5, 10, 10); // Tirador de resize
        }
    });
    ctx.restore();
}

// --- GUARDADO Y EXPORTACIÓN ---
function guardarLocal() {
    const data = JSON.stringify(elementos);
    const blob = new Blob([data], {type: "application/json"});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = "mi_cuaderno.json";
    a.click();
}

function exportarJPG() {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width; tempCanvas.height = canvas.height;
    const tCtx = tempCanvas.getContext('2d');
    tCtx.fillStyle = "white"; tCtx.fillRect(0,0, canvas.width, canvas.height);
    tCtx.translate(camera.x, camera.y); // Exporta lo que estás viendo actualmente
    // ... lógica de render similar ...
    const link = document.createElement('a');
    link.download = 'captura.jpg';
    link.href = canvas.toDataURL('image/jpeg');
    link.click();
}

// --- RED ---
socket.on('dibujar', obj => {
    if (obj.type === 'image') {
        const img = new Image(); img.src = obj.src;
        img.onload = () => { obj.imgObj = img; elementos.push(obj); render(); };
    } else { elementos.push(obj); render(); }
});

socket.on('cargar_historial', h => {
    elementos = h;
    elementos.forEach(el => {
        if(el.type === 'image') {
            el.imgObj = new Image(); el.imgObj.src = el.src;
            el.imgObj.onload = render;
        }
    });
    render();
});

function subirImagen() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = e => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = ev => {
            const img = new Image(); img.src = ev.target.result;
            img.onload = () => {
                const item = { type: 'image', x: -camera.x + 100, y: -camera.y + 100, w: 200, h: 200, src: img.src };
                item.imgObj = img; elementos.push(item);
                socket.emit('dibujar', item); render();
            };
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

window.onresize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; render(); };
render();
