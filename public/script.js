const socket = io();
const canvas = document.getElementById('pizarra');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let modo = 'select', elementos = [], dibujando = false, seleccionado = null, elementoActual = null;
let camera = { x: 0, y: 0 }, isPanning = false, startPan = { x: 0, y: 0 };
let handleSeleccionado = null, historialUndo = [], historialRedo = [];

const controls = { color: document.getElementById('color-picker'), grosor: document.getElementById('width-slider') };

// --- UTILIDADES DE MEMORIA ---
function guardarEstado() {
    const snap = JSON.stringify(elementos.map(el => { const { imgObj, ...r } = el; return r; }));
    historialUndo.push(snap);
    if (historialUndo.length > 30) historialUndo.shift();
    historialRedo = [];
}

function aplicarEstado(s) {
    elementos = s;
    elementos.forEach(el => { if(el.type === 'image'){ el.imgObj = new Image(); el.imgObj.src = el.src; el.imgObj.onload = render; }});
    render();
    socket.emit('sync_todo', elementos);
}

// --- BOTONES ---
document.querySelectorAll('#toolbar button[id^="btn-"]').forEach(btn => {
    btn.addEventListener('click', () => {
        const id = btn.id;
        if(id === 'btn-export') exportarJPG();
        else if(id === 'btn-save') guardarLocal();
        else if(id === 'btn-load') cargarLocal();
        else if(id === 'btn-clear') reiniciarLienzo();
        else {
            document.querySelectorAll('#toolbar button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            modo = id.replace('btn-', '');
            seleccionado = null; render();
        }
    });
});

// --- SISTEMA DE POSICIONAMIENTO ---
function getPos(e) {
    const t = (e.touches && e.touches.length > 0) ? e.touches[0] : e;
    const rect = canvas.getBoundingClientRect();
    return {
        x: (t.clientX - rect.left) - camera.x,
        y: (t.clientY - rect.top) - camera.y,
        rx: t.clientX - rect.left,
        ry: t.clientY - rect.top
    };
}

function obtenerHandles(el) {
    if (el.type === 'pen') return [];
    return [
        {x: el.x, y: el.y, n: 'tl'}, {x: el.x + el.w, y: el.y, n: 'tr'},
        {x: el.x, y: el.y + el.h, n: 'bl'}, {x: el.x + el.w, y: el.y + el.h, n: 'br'}
    ];
}

// --- EVENTOS DE INTERACCIÓN ---
const start = e => {
    const p = getPos(e);
    
    // Pan con dedo o botón central
    if(modo === 'pan' || e.button === 1) { 
        isPanning = true; 
        startPan = { x: p.rx - camera.x, y: p.ry - camera.y }; 
        return; 
    }

    if(modo === 'erase') { borrarEn(p); return; }

    if(modo === 'select') {
        if(seleccionado) {
            handleSeleccionado = obtenerHandles(seleccionado).find(h => Math.hypot(p.x - h.x, p.y - h.y) < 20);
            if(handleSeleccionado) return;
        }
        
        // Buscar objeto para seleccionar/arrastrar
        seleccionado = elementos.slice().reverse().find(el => {
            if(el.type === 'pen') return el.points.some(pt => Math.hypot(pt.x-p.x, pt.y-p.y) < el.grosor + 10);
            const x = el.w < 0 ? el.x + el.w : el.x, y = el.h < 0 ? el.y + el.h : el.y;
            return p.x >= x && p.x <= x + Math.abs(el.w) && p.y >= y && p.y <= y + Math.abs(el.h);
        });

        if(seleccionado) {
            seleccionado.ox = p.x - seleccionado.x;
            seleccionado.oy = p.y - seleccionado.y;
        }
        render(); 
        return;
    }

    if(modo === 'text') {
        const t = prompt("Escribe tu texto:");
        if(t) { 
            const obj = { type:'text', x: p.x, y: p.y, text: t, color: controls.color.value, w: 120, h: 30, grosor: 2 };
            elementos.push(obj); socket.emit('dibujar', obj); guardarEstado(); render(); 
        }
        return;
    }

    // Dibujo nuevo
    dibujando = true;
    elementoActual = { 
        id: Math.random(), type: modo, x: p.x, y: p.y, w: 0, h: 0, 
        color: controls.color.value, grosor: parseInt(controls.grosor.value), 
        points: [{x:p.x, y:p.y}] 
    };
};

const move = e => {
    const p = getPos(e);
    if(!dibujando && !isPanning) socket.emit('mover_cursor', { x: p.x, y: p.y });

    if(isPanning) { 
        camera.x = p.rx - startPan.x; 
        camera.y = p.ry - startPan.y; 
        render(); 
        return; 
    }

    if(dibujando && elementoActual) {
        if(modo === 'pen') elementoActual.points.push({x: p.x, y: p.y});
        else { elementoActual.w = p.x - elementoActual.x; elementoActual.h = p.y - elementoActual.y; }
        render();
    }

    if(modo === 'select' && seleccionado) {
        if(handleSeleccionado) {
            const h = handleSeleccionado.n, el = seleccionado;
            if(h.includes('r')) el.w = p.x - el.x; if(h.includes('l')) { el.w += el.x - p.x; el.x = p.x; }
            if(h.includes('b')) el.h = p.y - el.y; if(h.includes('t')) { el.h += el.y - p.y; el.y = p.y; }
        } else if (e.buttons === 1 || e.touches) {
            seleccionado.x = p.x - seleccionado.ox; 
            seleccionado.y = p.y - seleccionado.oy;
        }
        render();
    }
};

const end = () => {
    if(dibujando) { 
        elementos.push(elementoActual); 
        socket.emit('dibujar', elementoActual); 
        guardarEstado(); 
    } else if(seleccionado || modo === 'erase' || isPanning) { 
        socket.emit('sync_todo', elementos); 
        if(seleccionado) guardarEstado(); 
    }
    dibujando = isPanning = false; elementoActual = null; handleSeleccionado = null;
};

// --- FUNCIONES ADICIONALES ---
function borrarEn(p) {
    const i = elementos.findLastIndex(el => {
        if(el.type === 'pen') return el.points.some(pt => Math.hypot(pt.x-p.x, pt.y-p.y) < el.grosor + 15);
        const x = el.w < 0 ? el.x + el.w : el.x, y = el.h < 0 ? el.y + el.h : el.y;
        return p.x >= x && p.x <= x + Math.abs(el.w) && p.y >= y && p.y <= y + Math.abs(el.h);
    });
    if(i !== -1) { elementos.splice(i, 1); guardarEstado(); render(); socket.emit('sync_todo', elementos); }
}

function reiniciarLienzo() { if(confirm("¿Borrar todo?")) socket.emit('limpiar_todo'); }

function exportarJPG() {
    seleccionado = null; render();
    const temp = document.createElement('canvas'); 
    temp.width = canvas.width; temp.height = canvas.height;
    const t = temp.getContext('2d');
    t.fillStyle = "white"; t.fillRect(0,0,temp.width,temp.height);
    t.drawImage(canvas, 0, 0);
    const a = document.createElement('a'); a.download = 'dibujo.jpg'; a.href = temp.toDataURL('image/jpeg'); a.click();
}

function guardarLocal() {
    const blob = new Blob([JSON.stringify(elementos.map(el=>{const {imgObj,...r}=el; return r;}))], {type:"application/json"});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = "cuaderno.json"; a.click();
}

function cargarLocal() {
    const i = document.createElement('input'); i.type = 'file'; i.accept = '.json';
    i.onchange = e => {
        const r = new FileReader();
        r.onload = ev => { aplicarEstado(JSON.parse(ev.target.result)); guardarEstado(); };
        r.readAsText(e.target.files[0]);
    };
    i.click();
}

function subirImagen(p) {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
    i.onchange = e => {
        const r = new FileReader();
        r.onload = ev => {
            const img = new Image(); img.src = ev.target.result;
            img.onload = () => {
                const w = img.width > 300 ? 300 : img.width;
                const obj = { id: Math.random(), type:'image', x: p.x, y: p.y, w: w, h: (img.height/img.width)*w, src: img.src, grosor: 1 };
                obj.imgObj = img; elementos.push(obj); socket.emit('dibujar', obj); guardarEstado(); render();
            };
        };
        r.readAsDataURL(e.target.files[0]);
    };
    i.click();
}

// --- RENDERIZADO ---
function render() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.save(); ctx.translate(camera.x, camera.y);
    
    // Cuadrícula infinita
    ctx.strokeStyle = "#eee"; ctx.lineWidth = 1; ctx.beginPath();
    const step = 40;
    for(let x=-camera.x-((-camera.x)%step); x<canvas.width-camera.x; x+=step){ ctx.moveTo(x,-camera.y); ctx.lineTo(x,canvas.height-camera.y); }
    for(let y=-camera.y-((-camera.y)%step); y<canvas.height-camera.y; y+=step){ ctx.moveTo(-camera.x,y); ctx.lineTo(canvas.width-camera.x,y); }
    ctx.stroke();

    [...elementos, elementoActual].forEach(el => {
        if(!el) return;
        ctx.strokeStyle = el.color; ctx.fillStyle = el.color; ctx.lineWidth = el.grosor; ctx.lineCap = "round";
        if(el.type==='pen'){ ctx.beginPath(); el.points.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y)); ctx.stroke(); }
        else if(el.type==='rect') ctx.strokeRect(el.x, el.y, el.w, el.h);
        else if(el.type==='line'){ ctx.beginPath(); ctx.moveTo(el.x, el.y); ctx.lineTo(el.x+el.w, el.y+el.h); ctx.stroke(); }
        else if(el.type==='ellipse'){ ctx.beginPath(); ctx.ellipse(el.x+el.w/2, el.y+el.h/2, Math.abs(el.w/2), Math.abs(el.h/2), 0, 0, Math.PI*2); ctx.stroke(); }
        else if(el.type==='text'){ ctx.font = "24px Arial"; ctx.textBaseline = "top"; ctx.fillText(el.text, el.x, el.y); }
        else if(el.type==='image' && el.imgObj) ctx.drawImage(el.imgObj, el.x, el.y, el.w, el.h);
        
        if(modo==='select' && el === seleccionado && el.type !== 'pen'){
            ctx.setLineDash([5,5]); ctx.strokeStyle = "#2196F3"; ctx.strokeRect(el.x-4, el.y-4, el.w+8, el.h+8);
            ctx.setLineDash([]); ctx.fillStyle = "#2196F3";
            obtenerHandles(el).forEach(h => { ctx.beginPath(); ctx.arc(h.x, h.y, 6, 0, Math.PI*2); ctx.fill(); });
        }
    });
    ctx.restore();
}

// --- TECLADO ---
window.addEventListener('keydown', e => {
    if(e.ctrlKey && e.key === 'z') { e.preventDefault(); 
        if (historialUndo.length > 1) {
            historialRedo.push(historialUndo.pop());
            aplicarEstado(JSON.parse(historialUndo[historialUndo.length-1]));
        }
    }
    if(e.ctrlKey && (e.key === 'y' || e.key === 'x')) { e.preventDefault(); 
        if (historialRedo.length > 0) {
            const p = JSON.parse(historialRedo.pop());
            historialUndo.push(JSON.stringify(p));
            aplicarEstado(p);
        }
    }
});

// --- SOCKETS ---
socket.on('dibujar', o => {
    if(o.type==='image'){ const i=new Image(); i.src=o.src; i.onload=()=>{o.imgObj=i; elementos.push(o); render();}; }
    else { elementos.push(o); render(); }
});
socket.on('cargar_historial', h => {
    elementos = h; elementos.forEach(el=>{if(el.type==='image'){el.imgObj=new Image(); el.imgObj.src=el.src; el.imgObj.onload=render;}});
    render(); if(historialUndo.length===0) guardarEstado();
});
socket.on('limpiar_todo', () => { elementos = []; camera={x:0,y:0}; guardarEstado(); render(); });

const cur = {};
socket.on('mover_cursor', d => {
    if(!cur[d.id]){ const v=document.createElement('div'); v.className='cursor-fantasma'; document.getElementById('cursores').appendChild(v); cur[d.id]=v; }
    cur[d.id].style.left=(d.x+camera.x)+'px'; cur[d.id].style.top=(d.y+camera.y)+'px';
});
socket.on('borrar_cursor', id => { if(cur[id]){ cur[id].remove(); delete cur[id]; }});

// --- INICIO ---
canvas.addEventListener('mousedown', start); window.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
canvas.addEventListener('touchstart', start, {passive:false});
window.addEventListener('touchmove', move, {passive:false});
window.addEventListener('touchend', end);

window.onresize = () => { canvas.width=window.innerWidth; canvas.height=window.innerHeight; render(); };
guardarEstado(); 
render();
