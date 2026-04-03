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

// Cámara (PAN)
let camera = { x: 0, y: 0 };
let isPanning = false;
let startPan = { x: 0, y: 0 };

// Lógica de Resize
let handleSeleccionado = null;
const TAM_HANDLE = 10; // Tamaño de los cuadrados azules de resize

const controls = {
    color: document.getElementById('color-picker'),
    grosor: document.getElementById('width-slider')
};

// --- BOTONES ---
document.querySelectorAll('#toolbar button[id^="btn-"]').forEach(btn => {
    btn.addEventListener('click', () => {
        if(btn.id === 'btn-export') { exportarJPG(); return; }
        if(btn.id === 'btn-image') { subirImagen(); return; }
        if(btn.id === 'btn-save') { guardarLocal(); return; }
        if(btn.id === 'btn-load') { cargarArchivoLocal(); return; }
        if(btn.id === 'btn-clear') { reiniciarLienzo(); return; }
        
        document.querySelectorAll('#toolbar button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        modo = btn.id.replace('btn-', '');
        seleccionado = null; // Deseleccionar al cambiar de modo
        render();
    });
});

// --- COORDENADAS ---
function getPos(e) {
    const t = e.touches ? e.touches[0] : e;
    const rect = canvas.getBoundingClientRect();
    return { 
        x: t.clientX - rect.left - camera.x, 
        y: t.clientY - rect.top - camera.y,
        rawX: t.clientX - rect.left,
        rawY: t.clientY - rect.top
    };
}

// --- LÓGICA DE SELECCIÓN Y RESIZE (Handles) ---
function obtenerHandles(el) {
    if (el.type === 'pen') return []; // El lápiz no se redimensiona
    return [
        { x: el.x, y: el.y, name: 'tl' },         // Top Left
        { x: el.x + el.w / 2, y: el.y, name: 'tm' }, // Top Middle
        { x: el.x + el.w, y: el.y, name: 'tr' },     // Top Right
        { x: el.x, y: el.y + el.h / 2, name: 'ml' }, // Middle Left
        { x: el.x + el.w, y: el.y + el.h / 2, name: 'mr' }, // Middle Right
        { x: el.x, y: el.y + el.h, name: 'bl' },     // Bottom Left
        { x: el.x + el.w / 2, y: el.y + el.h, name: 'bm' }, // Bottom Middle
        { x: el.x + el.w, y: el.y + el.h, name: 'br' }      // Bottom Right
    ];
}

function hitTest(el, pos) {
    // Si es una línea o texto, normalizamos el ancho/alto para la detección
    const w = el.w;
    const h = el.h;
    
    // hitTest básico para figuras rectangulares
    if (el.type !== 'line') {
        // Normalizar rects con w o h negativos
        const x = el.w < 0 ? el.x + el.w : el.x;
        const y = el.h < 0 ? el.y + el.h : el.y;
        const width = Math.abs(el.w);
        const height = Math.abs(el.h);
        return pos.x >= x && pos.x <= x + width && pos.y >= y && pos.y <= y + height;
    } else {
        // HitTest para línea (con margen de error)
        return esPuntoCercaDeLinea(pos, {x: el.x, y: el.y}, {x: el.x+el.w, y: el.y+el.h}, el.grosor + 5);
    }
}

// --- EVENTOS ---
const startEvent = e => {
    const pos = getPos(e);
    
    if (modo === 'pan' || (e.button === 1)) {
        isPanning = true;
        startPan = { x: pos.rawX - camera.x, y: pos.rawY - camera.y };
        return;
    }

    if (modo === 'erase') {
        borrarObjetoEn(pos);
        return;
    }

    if (modo === 'select') {
        // 1. Ver si clickeamos en un handle del objeto seleccionado
        if (seleccionado) {
            const handles = obtenerHandles(seleccionado);
            handleSeleccionado = handles.find(h => 
                pos.x >= h.x - TAM_HANDLE/2 && pos.x <= h.x + TAM_HANDLE/2 &&
                pos.y >= h.y - TAM_HANDLE/2 && pos.y <= h.y + TAM_HANDLE/2
            );
            if (handleSeleccionado) return; // Empezar resize
        }

        // 2. Si no, buscar si clickeamos en un objeto nuevo
        // Buscamos al revés para agarrar el que está más arriba
        const hit = elementos.slice().reverse().find(el => {
            if (el.type === 'pen') {
                // Hit test especial para lápiz (revisar todos sus puntos)
                return el.points.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < el.grosor + 2);
            }
            return hitTest(el, pos);
        });

        if (hit) {
            seleccionado = hit;
            // Guardar offset para moverlo suavemente
            seleccionado.offsetX = pos.x - seleccionado.x;
            seleccionado.offsetY = pos.y - seleccionado.y;
        } else {
            seleccionado = null;
        }
        render();
        return;
    }

    if (modo === 'text') {
        crearTexto(pos);
        return;
    }

    // Modos de dibujo de figuras
    dibujando = true;
    const grosor = parseInt(controls.grosor.value);
    elementoActual = {
        id: Math.random().toString(36).substr(2, 9),
        type: modo, x: pos.x, y: pos.y, w: 0, h: 0,
        color: controls.color.value, grosor: grosor,
        points: modo === 'pen' ? [{x: pos.x, y: pos.y}] : []
    };
};

const moveEvent = e => {
    const pos = getPos(e);
    // Solo enviar cursor si no estamos dibujando/paneando para no saturar
    if(!dibujando && !isPanning) socket.emit('mover_cursor', { x: pos.x, y: pos.y });

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
        return;
    }

    if (modo === 'select' && seleccionado && (e.buttons === 1 || e.touches)) {
        if (handleSeleccionado) {
            // Lógica de RESIZE
            const h = handleSeleccionado.name;
            const el = seleccionado;
            
            if (h.includes('r')) el.w = pos.x - el.x;
            if (h.includes('l')) { el.w += el.x - pos.x; el.x = pos.x; }
            if (h.includes('b')) el.h = pos.y - el.y;
            if (h.includes('t')) { el.h += el.y - pos.y; el.y = pos.y; }
            
            // Prevenir tamaños negativos molestos (opcional, pero ayuda)
            if (el.type !== 'line') {
                if(el.w < 10 && !h.includes('l')) el.w = 10;
                if(el.h < 10 && !h.includes('t')) el.h = 10;
            }

        } else if (!isPanning) {
            // Lógica de MOVER
            seleccionado.x = pos.x - seleccionado.offsetX;
            seleccionado.y = pos.y - seleccionado.offsetY;
        }
        render();
    }
};

const endEvent = () => {
    if (dibujando && elementoActual) {
        // Normalizar figuras antes de guardar (evitar w/h negativos)
        if (elementoActual.type !== 'pen' && elementoActual.type !== 'line') {
            if (elementoActual.w < 0) { elementoActual.x += elementoActual.w; elementoActual.w = Math.abs(elementoActual.w); }
            if (elementoActual.h < 0) { elementoActual.y += elementoActual.h; elementoActual.h = Math.abs(elementoActual.h); }
        }
        elementos.push(elementoActual);
        socket.emit('dibujar', elementoActual);
    }
    
    // Sincronizar si movimos o redimensionamos algo
    if ((modo === 'select' && seleccionado && (handleSeleccionado || !isPanning)) || modo === 'erase') {
        socket.emit('sync_todo', elementos);
    }

    dibujando = false;
    isPanning = false;
    elementoActual = null;
    handleSeleccionado = null;
};

// Asignar eventos
canvas.addEventListener('mousedown', startEvent);
window.addEventListener('mousemove', moveEvent);
window.addEventListener('mouseup', endEvent);
canvas.addEventListener('touchstart', e => { e.preventDefault(); startEvent(e); }, {passive: false});
window.addEventListener('touchmove', e => { e.preventDefault(); moveEvent(e); }, {passive: false});
window.addEventListener('touchend', endEvent);

// --- FUNCIONES DE HERRAMIENTAS ---

function borrarObjetoEn(pos) {
    let borrado = false;
    // Buscamos de arriba a abajo
    for (let i = elementos.length - 1; i >= 0; i--) {
        const el = elementos[i];
        let hit = false;
        
        if (el.type === 'pen') {
            hit = el.points.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < el.grosor + 3);
        } else {
            hit = hitTest(el, pos);
        }

        if (hit) {
            elementos.splice(i, 1);
            borrado = true;
            break; // Solo borrar uno por clic
        }
    }
    if (borrado) {
        render();
        socket.emit('sync_todo', elementos);
    }
}

function crearTexto(pos) {
    const txt = prompt("Escribe tu texto:");
    if(!txt) return;
    
    ctx.font = "24px Arial";
    const metrics = ctx.measureText(txt);
    
    const nuevoText = { 
        id: Math.random().toString(36).substr(2, 9),
        type: 'text', 
        x: pos.x, 
        y: pos.y - 20, // Ajuste para que el mouse quede en el centro aproximado
        text: txt, 
        color: controls.color.value, 
        w: metrics.width, 
        h: 24, // Alto aproximado de la fuente
        grosor: 1 // No aplica, pero por consistencia
    };
    elementos.push(nuevoText);
    socket.emit('dibujar', nuevoText);
    render();
}

function reiniciarLienzo() {
    if (confirm("⚠️ ¿Estás seguro de reiniciar el lienzo? Se borrará para TODOS los usuarios.")) {
        socket.emit('limpiar_todo');
    }
}

// --- RENDERIZADO PRINCIPAL ---
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(camera.x, camera.y);

    // 1. Dibujar Fondo Cuadriculado
    drawGrid();

    // 2. Dibujar todos los objetos
    [...elementos, elementoActual].forEach(el => drawObject(el));

    // 3. Dibujar Handles de selección
    if (modo === 'select' && seleccionado) {
        drawSelectionData(seleccionado);
    }

    ctx.restore();
}

function drawGrid() {
    ctx.strokeStyle = "#e0e0e0"; ctx.lineWidth = 1; ctx.beginPath();
    const gridSize = 40;
    // Dibujar solo en el área visible
    const startX = -camera.x - ((-camera.x) % gridSize);
    const startY = -camera.y - ((-camera.y) % gridSize);
    for (let x = startX; x < canvas.width - camera.x; x += gridSize) {
        ctx.moveTo(x, -camera.y); ctx.lineTo(x, canvas.height - camera.y);
    }
    for (let y = startY; y < canvas.height - camera.y; y += gridSize) {
        ctx.moveTo(-camera.x, y); ctx.lineTo(canvas.width - camera.x, y);
    }
    ctx.stroke();
}

function drawObject(el) {
    if (!el) return;
    ctx.strokeStyle = el.color; ctx.fillStyle = el.color; 
    ctx.lineWidth = el.grosor; ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    switch (el.type) {
        case 'pen':
            if(el.points.length < 2) return;
            ctx.beginPath();
            ctx.moveTo(el.points[0].x, el.points[0].y);
            el.points.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.stroke();
            break;
        case 'line':
            ctx.beginPath(); ctx.moveTo(el.x, el.y); ctx.lineTo(el.x + el.w, el.y + el.h); ctx.stroke();
            break;
        case 'rect':
            ctx.strokeRect(el.x, el.y, el.w, el.h);
            break;
        case 'ellipse':
            ctx.beginPath();
            ctx.ellipse(el.x + el.w/2, el.y + el.h/2, Math.abs(el.w/2), Math.abs(el.h/2), 0, 0, Math.PI*2);
            ctx.stroke();
            break;
        case 'text':
            ctx.font = "24px Arial"; ctx.textBaseline = "top"; ctx.fillText(el.text, el.x, el.y);
            break;
        case 'image':
            if (el.imgObj) ctx.drawImage(el.imgObj, el.x, el.y, el.w, el.h);
            else ctx.strokeRect(el.x, el.y, el.w, el.h); // Placeholder si no carga
            break;
    }
}

function drawSelectionData(el) {
    // Recuadro punteado
    ctx.setLineDash([5, 5]); ctx.strokeStyle = "blue"; ctx.lineWidth = 1;
    if(el.type === 'line') {
         ctx.strokeRect(el.x - 5, el.y - 5, el.w + 10, el.h + 10); // Simplificado para línea
    } else {
        ctx.strokeRect(el.x - 5, el.y - 5, el.w + 10, el.h + 10);
    }
    ctx.setLineDash([]);

    // Dibujar Handles si no es lápiz
    if(el.type !== 'pen') {
        ctx.fillStyle = "white"; ctx.strokeStyle = "blue"; ctx.lineWidth = 2;
        obtenerHandles(el).forEach(h => {
            ctx.fillRect(h.x - TAM_HANDLE/2, h.y - TAM_HANDLE/2, TAM_HANDLE, TAM_HANDLE);
            ctx.strokeRect(h.x - TAM_HANDLE/2, h.y - TAM_HANDLE/2, TAM_HANDLE, TAM_HANDLE);
        });
    }
}

// --- GUARDADO Y EXPORTACIÓN ---

function exportarJPG() {
    seleccionado = null; render(); // Deseleccionar antes de exportar
    
    // Crear canvas temporal para el JPG (con fondo blanco)
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width; tempCanvas.height = canvas.height;
    const tCtx = tempCanvas.getContext('2d');
    
    // FIX: Dibujar fondo blanco sólido (si no, sale negro)
    tCtx.fillStyle = "white"; 
    tCtx.fillRect(0,0, tempCanvas.width, tempCanvas.height);
    
    // Copiar el contenido de la pizarra
    tCtx.drawImage(canvas, 0, 0);
    
    const a = document.createElement('a');
    a.download = 'captura_cuaderno.jpg'; 
    a.href = tempCanvas.toDataURL('image/jpeg', 0.9); // Alta calidad
    a.click();
}

function guardarLocal() {
    // Clonar elementos para no guardar las referencias a imágenes (imgObj)
    const copiaElementos = elementos.map(el => {
        const { imgObj, ...resto } = el;
        return resto;
    });
    const blob = new Blob([JSON.stringify(copiaElementos)], {type: "application/json"});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = "proyecto_cuaderno.json";
    a.click();
}

function cargarArchivoLocal() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
    input.onchange = e => {
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                elementos = JSON.parse(ev.target.result);
                // Re-cargar imágenes
                elementos.forEach(el => { 
                    if(el.type === 'image') { 
                        el.imgObj = new Image(); el.imgObj.src = el.src; 
                        el.imgObj.onload = render; 
                    } 
                });
                render();
                socket.emit('sync_todo', elementos);
            } catch(e) { alert("Error al cargar el archivo JSON."); }
        };
        reader.readAsText(e.target.files[0]);
    };
    input.click();
}

function subirImagen() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = e => {
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            const img = new Image(); img.src = ev.target.result;
            img.onload = () => {
                // Centrar imagen en la vista actual
                const w = img.width > 500 ? 500 : img.width;
                const h = (img.height / img.width) * w;
                const item = { 
                    id: Math.random().toString(36).substr(2, 9),
                    type: 'image', 
                    x: -camera.x + (canvas.width/2) - (w/2), 
                    y: -camera.y + (canvas.height/2) - (h/2), 
                    w: w, h: h, src: img.src, grosor: 1 
                };
                item.imgObj = img; elementos.push(item);
                socket.emit('dibujar', item); render();
            };
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

// --- SOCKETS ---
socket.on('dibujar', obj => {
    if(obj.type === 'image') {
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

socket.on('limpiar_todo', () => { 
    elementos = []; seleccionado = null; camera = {x:0, y:0}; render(); 
});

const cursoresActivos = {};
socket.on('mover_cursor', d => {
    if (d.id === socket.id) return; // No dibujar mi propio cursor
    if (!cursoresActivos[d.id]) {
        const div = document.createElement('div'); div.className = 'cursor-fantasma';
        document.getElementById('cursores').appendChild(div);
        cursoresActivos[d.id] = div;
    }
    // Traducir coords del mundo a coords de pantalla
    cursoresActivos[d.id].style.left = (d.x + camera.x) + 'px';
    cursoresActivos[d.id].style.top = (d.y + camera.y) + 'px';
});

socket.on('borrar_cursor', id => {
    if(cursoresActivos[id]) { cursoresActivos[id].remove(); delete cursoresActivos[id]; }
});

// Utilidades matemáticas
function esPuntoCercaDeLinea(p, a, b, d) {
    const l2 = Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2);
    if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y) < d;
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const proyeccion = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    return Math.hypot(p.x - proyeccion.x, p.y - proyeccion.y) < d;
}

window.onresize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; render(); };
render(); // Primera ejecución
