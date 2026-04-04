const pass = prompt("🔐 Contraseña:");
const miNombre = prompt("👤 Tu nombre:") || "Anónimo";
const socket = io({ auth: { password: pass } });

socket.on('connect_error', (err) => { alert("❌ " + err.message); window.location.reload(); });

const canvas = document.getElementById('pizarra');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
canvas.width = window.innerWidth; canvas.height = window.innerHeight;

let modo = 'select', elementos = [], dibujando = false, elementoActual = null;
let camera = { x: 0, y: 0, z: 1 }, isPanning = false, startPan = { x: 0, y: 0 };
let historialUndo = [], historialRedo = [], historialCargado = false, cambioRealizado = false;
let initialPinchDist = null, initialCamZ = 1, initialCamX = 0, initialCamY = 0, pinchCenter = {x:0, y:0};
let seleccionados = [], boxSeleccion = null, handleSeleccionado = null, lastMousePos = { x: 0, y: 0 };
let lasersActivos = {}, miLaserId = null;

let cursoresData = {}; 
let siguiendoA = null;
let ultimoClickTime = 0;

const controls = { color: document.getElementById('color-picker'), grosor: document.getElementById('width-slider') };

let renderRequerido = true;
function pedirRender() { if (!renderRequerido) { renderRequerido = true; requestAnimationFrame(ejecutarRender); } }
setInterval(pedirRender, 1000/60);

// --- NUEVA FUNCIÓN: EDITOR DE TEXTO MULTILÍNEA ---
function mostrarEditorTexto(valorInicial, callback) {
    const overlay = document.createElement('div');
    overlay.id = 'text-editor-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'editor-modal';
    
    const textarea = document.createElement('textarea');
    textarea.value = valorInicial;
    textarea.placeholder = "Escribe aquí... (Enter para saltar línea)";
    
    const btn = document.createElement('button');
    btn.innerText = "Guardar";
    
    modal.appendChild(textarea);
    modal.appendChild(btn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    setTimeout(() => textarea.focus(), 100);

    const finalizar = () => {
        const texto = textarea.value.trim();
        if (texto) callback(texto);
        document.body.removeChild(overlay);
    };

    btn.onclick = finalizar;
    overlay.onclick = (e) => { if(e.target === overlay) finalizar(); };
}

function actualizarListaUI() {
    const list = document.getElementById('user-list');
    list.innerHTML = '';
    for (let id in cursoresData) {
        const div = document.createElement('div');
        div.className = 'user-item' + (siguiendoA === id ? ' active' : '');
        div.innerText = cursoresData[id].nombre;
        div.onclick = () => {
            if (siguiendoA === id) dejarDeSeguir();
            else iniciarSeguimiento(id, cursoresData[id].nombre);
        };
        list.appendChild(div);
    }
}

function iniciarSeguimiento(id, nombre) {
    siguiendoA = id;
    document.getElementById('follow-name').innerText = nombre;
    document.getElementById('follow-banner').classList.remove('hidden');
    actualizarListaUI();
}

function dejarDeSeguir() { siguiendoA = null; document.getElementById('follow-banner').classList.add('hidden'); actualizarListaUI(); }
document.getElementById('btn-unfollow').onclick = dejarDeSeguir;

const enviarCursor = (() => {
    let inThrottle;
    return (x, y) => {
        if (!inThrottle) {
            socket.emit('mover_cursor', { x, y, nombre: miNombre });
            inThrottle = true; setTimeout(() => inThrottle = false, 50);
        }
    }
})();

function guardarEstado() {
    const snap = JSON.stringify(elementos.map(el => { const { imgObj, ...r } = el; return r; }));
    historialUndo.push(snap); if (historialUndo.length > 30) historialUndo.shift(); historialRedo = [];
}

function aplicarEstado(s) {
    elementos = s;
    elementos.forEach(el => { if(el.type === 'image'){ el.imgObj = new Image(); el.imgObj.src = el.src; }});
    pedirRender(); if(historialCargado) socket.emit('sync_todo', elementos);
}

function traerAlFrente() { if (seleccionados.length === 0) return; elementos = elementos.filter(el => !seleccionados.includes(el)); elementos.push(...seleccionados); guardarEstado(); if(historialCargado) socket.emit('sync_todo', elementos); pedirRender(); }
function enviarAlFondo() { if (seleccionados.length === 0) return; elementos = elementos.filter(el => !seleccionados.includes(el)); elementos.unshift(...seleccionados); guardarEstado(); if(historialCargado) socket.emit('sync_todo', elementos); pedirRender(); }

document.querySelectorAll('#toolbar button[id^="btn-"]').forEach(btn => {
    btn.onclick = () => {
        const id = btn.id;
        if(['btn-export', 'btn-save', 'btn-load', 'btn-clear', 'btn-zoom_reset', 'btn-undo', 'btn-redo', 'btn-front', 'btn-back'].includes(id)) {
            if(id==='btn-export') exportarJPG(); if(id==='btn-save') guardarLocal(); if(id==='btn-load') cargarLocal(); 
            if(id==='btn-clear') reiniciarLienzo(); if(id==='btn-zoom_reset'){ camera={x:0,y:0,z:1}; pedirRender(); }
            if(id==='btn-undo') undo(); if(id==='btn-redo') redo(); if(id==='btn-front') traerAlFrente(); if(id==='btn-back') enviarAlFondo();
            return;
        }
        if(id === 'btn-image') { subirImagen(); return; }
        document.querySelectorAll('#toolbar button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); modo = id.replace('btn-', ''); seleccionados = []; pedirRender();
    };
});

function getPos(e) {
    let cX, cY;
    if (e.touches && e.touches.length > 0) { cX = e.touches[0].clientX; cY = e.touches[0].clientY; } 
    else if (e.changedTouches && e.changedTouches.length > 0) { cX = e.changedTouches[0].clientX; cY = e.changedTouches[0].clientY; } 
    else { cX = e.clientX; cY = e.clientY; }
    const r = canvas.getBoundingClientRect();
    const sX = canvas.width / r.width, sY = canvas.height / r.height;
    const sx = (cX - r.left) * sX, sy = (cY - r.top) * sY;
    return { x: (sx - camera.x) / camera.z, y: (sy - camera.y) / camera.z, rx: sx, ry: sy };
}

canvas.addEventListener('wheel', e => {
    e.preventDefault(); dejarDeSeguir();
    const zoomSensitivity = 0.001;
    let newZ = camera.z * Math.exp(-e.deltaY * zoomSensitivity);
    newZ = Math.max(0.1, Math.min(newZ, 10));
    const r = canvas.getBoundingClientRect();
    const sX = canvas.width / r.width, sY = canvas.height / r.height;
    const mX = (e.clientX - r.left) * sX;
    const mY = (e.clientY - r.top) * sY;
    camera.x = mX - (mX - camera.x) * (newZ / camera.z);
    camera.y = mY - (mY - camera.y) * (newZ / camera.z);
    camera.z = newZ; pedirRender();
}, { passive: false });

const start = e => {
    const ahora = Date.now(); const dif = ahora - ultimoClickTime; ultimoClickTime = ahora;
    if(e.touches && e.touches.length === 2) {
        dejarDeSeguir(); isPanning = false; dibujando = false; seleccionados = [];
        const t1 = e.touches[0], t2 = e.touches[1]; initialPinchDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        initialCamZ = camera.z; initialCamX = camera.x; initialCamY = camera.y; pinchCenter = { x: (t1.clientX + t2.clientX)/2, y: (t1.clientY + t2.clientY)/2 }; return;
    }
    const p = getPos(e);
    if(modo === 'pan' || e.button === 1) { dejarDeSeguir(); isPanning = true; startPan = { x: p.rx - camera.x, y: p.ry - camera.y }; return; }
    if(modo === 'erase') { borrarEn(p); return; }

    if(modo === 'select') {
        const hit = elementos.slice().reverse().find(el => {
            if(el.type === 'pen') return el.points.some(pt => Math.hypot(pt.x-p.x, pt.y-p.y) < (el.grosor + 15)/camera.z);
            const x = el.w < 0 ? el.x + el.w : el.x, y = el.h < 0 ? el.y + el.h : el.y;
            return p.x >= x && p.x <= x + Math.abs(el.w) && p.y >= y && p.y <= y + Math.abs(el.h);
        });

        // EDITAR MULTILÍNEA CON DOBLE CLIC
        if (dif < 300 && hit && (hit.type === 'text' || hit.type === 'sticky')) {
            mostrarEditorTexto(hit.text, (nuevo) => {
                hit.text = nuevo; guardarEstado(); 
                if(historialCargado) socket.emit('sync_todo', elementos);
                pedirRender();
            });
            return;
        }

        if(hit) {
            if (!seleccionados.includes(hit)) seleccionados = [hit];
            lastMousePos = { x: p.x, y: p.y };
            if(seleccionados.length === 1 && hit.type !== 'pen' && hit.type !== 'sticky') {
                handleSeleccionado = [{x:hit.x,y:hit.y,n:'tl'},{x:hit.x+hit.w,y:hit.y,n:'tr'},{x:hit.x,y:hit.y+hit.h,n:'bl'},{x:hit.x+hit.w,y:hit.y+hit.h,n:'br'}].find(h => Math.hypot(p.x - h.x, p.y - h.y) < 30/camera.z);
            }
        } else { seleccionados = []; boxSeleccion = { startX: p.x, startY: p.y, x: p.x, y: p.y, w: 0, h: 0 }; }
        pedirRender(); return;
    }

    if(modo === 'laser') {
        dibujando = true; miLaserId = Math.random().toString(36).substr(2,9);
        lasersActivos[miLaserId] = { color: controls.color.value, points: [{x: p.x, y: p.y, t: Date.now()}] };
        socket.emit('dibujar_laser', { id: miLaserId, color: controls.color.value, pt: {x: p.x, y: p.y, t: Date.now()} }); return;
    }

    if(modo === 'sticky') {
        mostrarEditorTexto("", (t) => {
            const obj = { id: Math.random(), type:'sticky', x: p.x, y: p.y, text: t, color: controls.color.value, w: 200, h: 200, grosor: 1 }; 
            elementos.push(obj); socket.emit('dibujar', obj); guardarEstado(); pedirRender();
        });
        return;
    }

    if(modo === 'text') {
        mostrarEditorTexto("", (t) => {
            const obj = { type:'text', x: p.x, y: p.y, text: t, color: controls.color.value, w: 120, h: 30, grosor: 2 }; 
            elementos.push(obj); socket.emit('dibujar', obj); guardarEstado(); pedirRender();
        });
        return;
    }

    dibujando = true;
    elementoActual = { id: Math.random(), type: modo, x: p.x, y: p.y, w: 0, h: 0, color: controls.color.value, grosor: parseInt(controls.grosor.value), points: [{x:p.x, y:p.y}] };
};

const move = e => {
    if(e.touches && e.touches.length === 2 && initialPinchDist) {
        const t1 = e.touches[0], t2 = e.touches[1]; const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        let newZ = initialCamZ * (currentDist / initialPinchDist); newZ = Math.max(0.1, Math.min(newZ, 10));
        const currentCenter = { x: (t1.clientX + t2.clientX)/2, y: (t1.clientY + t2.clientY)/2 };
        camera.x = currentCenter.x - (pinchCenter.x - initialCamX) * (newZ / initialCamZ); camera.y = currentCenter.y - (pinchCenter.y - initialCamY) * (newZ / initialCamZ);
        camera.z = newZ; pedirRender(); return;
    }
    const p = getPos(e);
    if(!dibujando && !isPanning) enviarCursor(p.x, p.y); 
    if(isPanning) { camera.x = p.rx - startPan.x; camera.y = p.ry - startPan.y; pedirRender(); return; }

    if (modo === 'laser' && dibujando) {
        const pt = {x: p.x, y: p.y, t: Date.now()}; lasersActivos[miLaserId].points.push(pt);
        socket.emit('dibujar_laser', { id: miLaserId, color: controls.color.value, pt: pt }); return; 
    }
    if(dibujando && elementoActual) {
        if(modo === 'pen') elementoActual.points.push({x: p.x, y: p.y});
        else { elementoActual.w = p.x - elementoActual.x; elementoActual.h = p.y - elementoActual.y; }
        pedirRender();
    }
    if(modo === 'select') {
        if(boxSeleccion) {
            boxSeleccion.x = Math.min(p.x, boxSeleccion.startX); boxSeleccion.y = Math.min(p.y, boxSeleccion.startY);
            boxSeleccion.w = Math.abs(p.x - boxSeleccion.startX); boxSeleccion.h = Math.abs(p.y - boxSeleccion.startY);
        } else if(handleSeleccionado) {
            const h = handleSeleccionado.n, el = seleccionados[0];
            if(h.includes('r')) el.w = p.x - el.x; if(h.includes('l')) { el.w += el.x - p.x; el.x = p.x; }
            if(h.includes('b')) el.h = p.y - el.y; if(h.includes('t')) { el.h += el.y - p.y; el.y = p.y; }
            cambioRealizado = true;
        } else if (seleccionados.length > 0 && (e.buttons === 1 || e.touches)) {
            const dx = p.x - lastMousePos.x; const dy = p.y - lastMousePos.y;
            seleccionados.forEach(el => { if (el.type === 'pen') { el.points.forEach(pt => { pt.x += dx; pt.y += dy; }); } else { el.x += dx; el.y += dy; } });
            lastMousePos = { x: p.x, y: p.y }; cambioRealizado = true;
        }
        pedirRender();
    }
};

const end = e => {
    if (boxSeleccion) {
        seleccionados = elementos.filter(el => {
            let eX, eW, eY, eH;
            if(el.type === 'pen'){ const xs = el.points.map(pt=>pt.x); eX = Math.min(...xs); eW = Math.max(...xs)-eX; const ys = el.points.map(pt=>pt.y); eY = Math.min(...ys); eH = Math.max(...ys)-eY; }
            else { eX = el.w < 0 ? el.x + el.w : el.x; eW = Math.abs(el.w); eY = el.h < 0 ? el.y + el.h : el.y; eH = Math.abs(el.h); }
            return (eX < boxSeleccion.x + boxSeleccion.w && eX + eW > boxSeleccion.x && eY < boxSeleccion.y + boxSeleccion.h && eY + eH > boxSeleccion.y);
        });
        boxSeleccion = null;
    }
    if(dibujando && elementoActual) { elementos.push(elementoActual); socket.emit('dibujar', elementoActual); guardarEstado(); } 
    else if (cambioRealizado) { if(historialCargado) socket.emit('sync_todo', elementos); guardarEstado(); cambioRealizado = false; }
    dibujando = isPanning = false; elementoActual = null; handleSeleccionado = null; pedirRender();
};

function borrarEn(p) {
    const i = elementos.findLastIndex(el => {
        if(el.type === 'pen') return el.points.some(pt => Math.hypot(pt.x-p.x, pt.y-p.y) < (el.grosor + 15)/camera.z);
        const x = el.w < 0 ? el.x + el.w : el.x, y = el.h < 0 ? el.y + el.h : el.y;
        return p.x >= x && p.x <= x + Math.abs(el.w) && p.y >= y && p.y <= y + Math.abs(el.h);
    });
    if(i !== -1) { elementos.splice(i, 1); guardarEstado(); pedirRender(); if(historialCargado) socket.emit('sync_todo', elementos); }
}

function reiniciarLienzo() { if(confirm("¿Borrar todo?")) socket.emit('limpiar_todo'); }
function guardarLocal() { const blob = new Blob([JSON.stringify(elementos.map(el=>{const {imgObj,...r}=el; return r;}))], {type:"application/json"}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = "cuaderno.json"; a.click(); }
function cargarLocal() { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json'; i.onchange = e => { const r = new FileReader(); r.onload = ev => { aplicarEstado(JSON.parse(ev.target.result)); guardarEstado(); }; r.readAsText(e.target.files[0]); }; i.click(); }

function exportarJPG() {
    seleccionados = []; pedirRender();
    setTimeout(() => {
        if (elementos.length === 0) return alert("Pizarra vacía.");
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        elementos.forEach(el => {
            if (el.type === 'pen') { el.points.forEach(pt => { minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x); minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y); }); }
            else { const x = el.w < 0 ? el.x + el.w : el.x; const y = el.h < 0 ? el.y + el.h : el.y; minX = Math.min(minX, x); maxX = Math.max(maxX, x + Math.abs(el.w)); minY = Math.min(minY, y); maxY = Math.max(maxY, y + Math.abs(el.h)); }
        });
        const pad = 100; minX -= pad; minY -= pad; maxX += pad; maxY += pad;
        const temp = document.createElement('canvas'); temp.width = maxX - minX; temp.height = maxY - minY;
        const t = temp.getContext('2d'); t.fillStyle = "#fefefe"; t.fillRect(0,0,temp.width,temp.height);
        t.save(); t.translate(-minX, -minY); elementos.forEach(el => helperDibujarElemento(t, el, 1)); t.restore();
        const a = document.createElement('a'); a.download = 'Captura.jpg'; a.href = temp.toDataURL('image/jpeg', 0.9); a.click();
    }, 50);
}

// --- FIX: RENDERIZADO DE MÚLTIPLES LÍNEAS ---
function helperDibujarElemento(c, el, z) {
    c.strokeStyle = el.color; c.fillStyle = el.color; c.lineWidth = el.grosor; c.lineCap = "round"; c.lineJoin = "round";
    if(el.type==='pen'){ c.beginPath(); el.points.forEach((p,i)=>i===0?c.moveTo(p.x,p.y):c.lineTo(p.x,p.y)); c.stroke(); }
    else if(el.type==='rect') c.strokeRect(el.x, el.y, el.w, el.h);
    else if(el.type==='line'){ c.beginPath(); c.moveTo(el.x, el.y); c.lineTo(el.x+el.w, el.y+el.h); c.stroke(); }
    else if(el.type==='ellipse'){ c.beginPath(); c.ellipse(el.x+el.w/2, el.y+el.h/2, Math.abs(el.w/2), Math.abs(el.h/2), 0, 0, Math.PI*2); c.stroke(); }
    else if(el.type==='text'){ 
        c.font = "24px Arial"; c.textBaseline = "top";
        const lineas = el.text.split('\n');
        lineas.forEach((lin, i) => c.fillText(lin, el.x, el.y + (i * 28))); 
    }
    else if(el.type==='image' && el.imgObj) c.drawImage(el.imgObj, el.x, el.y, el.w, el.h);
    else if(el.type==='sticky') {
        c.shadowColor = 'rgba(0,0,0,0.1)'; c.shadowBlur = 10; c.fillRect(el.x, el.y, el.w, el.h); c.shadowColor = 'transparent';
        c.fillStyle = "#222"; c.font = "bold 18px Arial"; c.textBaseline = "top";
        
        const parrafos = el.text.split('\n');
        let tY = el.y + 15;
        parrafos.forEach(parr => {
            const words = parr.split(' '); let line = '';
            for(let n = 0; n < words.length; n++) {
                const test = line + words[n] + ' ';
                if (c.measureText(test).width > el.w - 30 && n > 0) { c.fillText(line, el.x + 15, tY); line = words[n] + ' '; tY += 24; } 
                else { line = test; }
            }
            c.fillText(line, el.x + 15, tY); tY += 24;
        });
        if (tY + 15 > el.y + el.h) el.h = (tY - el.y) + 15; 
    }
}

function ejecutarRender() {
    renderRequerido = false; ctx.fillStyle = "#fefefe"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.translate(camera.x, camera.y); ctx.scale(camera.z, camera.z);
    ctx.strokeStyle = "#eeeeee"; ctx.lineWidth = 1 / camera.z; ctx.beginPath();
    const stp = 40; const sX = (-camera.x/camera.z) - ((-camera.x/camera.z)%stp) - stp; const sY = (-camera.y/camera.z) - ((-camera.y/camera.z)%stp) - stp;
    for(let x = sX; x < (canvas.width-camera.x)/camera.z + stp; x += stp) { ctx.moveTo(x, (-camera.y/camera.z)); ctx.lineTo(x, (canvas.height-camera.y)/camera.z); }
    for(let y = sY; y < (canvas.height-camera.y)/camera.z + stp; y += stp) { ctx.moveTo((-camera.x/camera.z), y); ctx.lineTo((canvas.width-camera.x)/camera.z, y); }
    ctx.stroke();
    [...elementos, elementoActual].forEach(el => { if(!el) return; helperDibujarElemento(ctx, el, camera.z); if(modo==='select' && seleccionados.includes(el)){ ctx.setLineDash([5/camera.z, 5/camera.z]); ctx.strokeStyle = "#2196F3"; ctx.lineWidth = 2/camera.z; if(el.type==='pen'){ const xs=el.points.map(pt=>pt.x), ys=el.points.map(pt=>pt.y); ctx.strokeRect(Math.min(...xs)-5, Math.min(...ys)-5, Math.max(...xs)-Math.min(...xs)+10, Math.max(...ys)-Math.min(...ys)+10); } else ctx.strokeRect(el.x, el.y, el.w, el.h); ctx.setLineDash([]); } });
    if (boxSeleccion) { ctx.fillStyle = "rgba(33, 150, 243, 0.1)"; ctx.strokeStyle = "#2196F3"; ctx.lineWidth = 1/camera.z; ctx.fillRect(boxSeleccion.x, boxSeleccion.y, boxSeleccion.w, boxSeleccion.h); ctx.strokeRect(boxSeleccion.x, boxSeleccion.y, boxSeleccion.w, boxSeleccion.h); }
    const now = Date.now();
    for (let id in lasersActivos) {
        const lr = lasersActivos[id]; lr.points = lr.points.filter(pt => now - pt.t < 1500);
        if (lr.points.length > 0) { ctx.beginPath(); ctx.strokeStyle = lr.color; ctx.lineWidth = 6 / camera.z; ctx.lineCap = "round"; ctx.shadowBlur = 10 / camera.z; ctx.shadowColor = lr.color; lr.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)); ctx.stroke(); ctx.shadowBlur = 0; } else delete lasersActivos[id];
    }
    ctx.restore();
}

socket.on('dibujar', o => { if(o.type==='image'){ const i=new Image(); i.src=o.src; i.onload=()=>{o.imgObj=i; elementos.push(o); pedirRender();}; } else { elementos.push(o); pedirRender(); } });
socket.on('cargar_historial', h => { elementos = h; historialCargado = true; elementos.forEach(el=>{if(el.type==='image'){el.imgObj=new Image(); el.imgObj.src=el.src;}}); pedirRender(); if(historialUndo.length===0) guardarEstado(); });
socket.on('limpiar_todo', () => { elementos = []; camera={x:0,y:0,z:1}; pedirRender(); });
socket.on('dibujar_laser', d => { if(!lasersActivos[d.id]) lasersActivos[d.id] = { color: d.color, points: [] }; lasersActivos[d.id].points.push(d.pt); });
socket.on('mover_cursor', d => {
    cursoresData[d.id] = { x: d.x, y: d.y, nombre: d.nombre };
    if (siguiendoA === d.id) { camera.x = (canvas.width / 2) - (d.x * camera.z); camera.y = (canvas.height / 2) - (d.y * camera.z); }
    if(!cur[d.id]){ const v=document.createElement('div'); v.className='cursor-fantasma'; v.setAttribute('data-nombre', d.nombre || "Anónimo"); document.getElementById('cursores').appendChild(v); cur[d.id]=v; actualizarListaUI(); }
    cur[d.id].style.left=(d.x * camera.z + camera.x)+'px'; cur[d.id].style.top=(d.y * camera.z + camera.y)+'px'; pedirRender();
});
socket.on('borrar_cursor', id => { if(cur[id]){ cur[id].remove(); delete cur[id]; } delete cursoresData[id]; if(siguiendoA === id) dejarDeSeguir(); actualizarListaUI(); });

function subirImagen() {
    const iF = document.createElement('input'); iF.type = 'file'; iF.accept = 'image/*';
    iF.onchange = e => {
        const file = e.target.files[0]; if (!file) return; const r = new FileReader();
        r.onload = ev => {
            const img = new Image(); img.src = ev.target.result;
            img.onload = () => {
                const maxSize = 800; let w = img.width, h = img.height;
                if (w > maxSize || h > maxSize) { if (w > h) { h = (maxSize / w) * h; w = maxSize; } else { w = (maxSize / h) * w; h = maxSize; } }
                const tC = document.createElement('canvas'); tC.width = w; tC.height = h; const tX = tC.getContext('2d'); tX.fillStyle = "#ffffff"; tX.fillRect(0,0,w,h); tX.drawImage(img, 0, 0, w, h);
                const cSrc = tC.toDataURL('image/jpeg', 0.8); const fI = new Image(); fI.src = cSrc;
                fI.onload = () => { const vW = w > 300 ? 300 : w; const vH = (h/w)*vW; const cX = (-camera.x + canvas.width/2)/camera.z - vW/2; const cY = (-camera.y + canvas.height/2)/camera.z - vH/2; const o = { id: Math.random(), type:'image', x: cX, y: cY, w: vW, h: vH, src: cSrc, grosor: 1 }; o.imgObj = fI; elementos.push(o); socket.emit('dibujar', o); guardarEstado(); pedirRender(); };
            };
        }; r.readAsDataURL(file);
    }; iF.click();
}

canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
canvas.addEventListener('touchstart', e => { e.preventDefault(); start(e); }, {passive:false});
canvas.addEventListener('touchmove', e => { e.preventDefault(); move(e); }, {passive:false});
canvas.addEventListener('touchend', e => { e.preventDefault(); end(e); }, {passive:false});
window.addEventListener('resize', () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; pedirRender(); });
guardarEstado(); requestAnimationFrame(ejecutarRender);
