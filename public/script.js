const token = localStorage.getItem('token_cuaderno');
if (!token) window.location.href = 'login.html';

const urlParams = new URLSearchParams(window.location.search);
let miSala = urlParams.get('sala');
if (!miSala) { miSala = Math.random().toString(36).substr(2, 6); window.location.href = `?sala=${miSala}`; }

document.getElementById('codigo-sala-ui').innerText = miSala;
document.getElementById('sala-id-display').innerText = miSala;

const miNombre = localStorage.getItem('nombre_usuario') || "Usuario";
const socket = io({ auth: { token: token, salaId: miSala } });

socket.on('connect_error', (err) => { alert("❌ Tu sesión ha caducado."); window.location.href = 'login.html'; });
socket.on('esperando_aprobacion', () => { document.getElementById('texto-espera').innerText = "⏳ Esperando al dueño..."; });
socket.on('acceso_denegado', () => { document.getElementById('texto-espera').innerText = "❌ Solicitud rechazada."; document.getElementById('btn-cancelar').style.background = "#2196F3"; document.getElementById('btn-cancelar').style.color = "white"; });

socket.on('acceso_permitido', (historial) => {
    document.getElementById('pantalla-espera').style.display = 'none';
    elementos = historial; historialCargado = true;
    elementos.forEach(el=>{if(el.type==='image'){el.imgObj=new Image(); el.imgObj.src=el.src;}}); 
    pedirRender(); if(historialUndo.length===0) guardarEstado();
});

socket.on('alguien_quiere_entrar', (data) => {
    const contenedor = document.getElementById('contenedor-notificaciones');
    const toast = document.createElement('div'); toast.className = 'toast';
    toast.innerHTML = `<span><span class="material-symbols-outlined" style="margin-right: 8px; color: #2196F3;">person_add</span> <b>${data.nombre}</b> quiere entrar.</span><div class="toast-btns"><button class="btn-aceptar">Permitir</button><button class="btn-rechazar">Ignorar</button></div>`;
    toast.querySelector('.btn-aceptar').onclick = () => { socket.emit('responder_acceso', { guestId: data.guestId, aprobado: true }); toast.remove(); };
    toast.querySelector('.btn-rechazar').onclick = () => { socket.emit('responder_acceso', { guestId: data.guestId, aprobado: false }); toast.remove(); };
    contenedor.appendChild(toast); setTimeout(() => { if(toast.parentNode) toast.remove(); }, 30000);
});

const canvas = document.getElementById('pizarra');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
canvas.width = window.innerWidth; canvas.height = window.innerHeight;

const miniCanvas = document.getElementById('minimap');
const mCtx = miniCanvas.getContext('2d');
let verMinimapa = false;

// Carga Segura de la Librería PDF
let pdfjsLib;
try {
    if (window['pdfjs-dist/build/pdf']) {
        pdfjsLib = window['pdfjs-dist/build/pdf'];
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    }
} catch (e) {
    console.error("La librería PDF no pudo inicializarse correctamente.", e);
}

// Vuelve a ser 'select' por defecto
let modo = 'select', elementos = [], dibujando = false, elementoActual = null;
let camera = { x: 0, y: 0, z: 1 }, isPanning = false, startPan = { x: 0, y: 0 };
let historialUndo = [], historialRedo = [], historialCargado = false, cambioRealizado = false;
let portapapeles = [];
let initialPinchDist = null, initialCamZ = 1, initialCamX = 0, initialCamY = 0, pinchCenter = {x:0, y:0};
let seleccionados = [], boxSeleccion = null, handleSeleccionado = null, lastMousePos = { x: 0, y: 0 };
let lasersActivos = {}, miLaserId = null;
let cursoresData = {}, siguiendoA = null, ultimoClickTime = 0, miPosicionMundo = { x: 0, y: 0 }, isPenEraser = false; 

const controls = { color: document.getElementById('color-picker'), grosor: document.getElementById('width-slider') };

setInterval(() => {
    const now = Date.now();
    for (let id in cursoresData) {
        if (now - cursoresData[id].lastUpdate > 10000) { if (cur[id]) { cur[id].remove(); delete cur[id]; } delete cursoresData[id]; if (siguiendoA === id) dejarDeSeguir(); }
    }
    actualizarListaUI();
}, 3000);

let renderRequerido = true;
function pedirRender() { if (!renderRequerido) { renderRequerido = true; requestAnimationFrame(ejecutarRender); } }
setInterval(pedirRender, 1000/60);

function guardarEstado() {
    const snapshot = JSON.stringify(elementos.map(el => { const { imgObj, ...datos } = el; return datos; }));
    if (historialUndo.length > 0 && historialUndo[historialUndo.length - 1] === snapshot) return;
    historialUndo.push(snapshot); if (historialUndo.length > 50) historialUndo.shift(); historialRedo = []; 
}

function aplicarEstado(snapshotJSON) {
    if (!snapshotJSON) return; const data = typeof snapshotJSON === 'string' ? JSON.parse(snapshotJSON) : snapshotJSON; if (!Array.isArray(data)) return;
    elementos = data; elementos.forEach(el => { if(el.type === 'image' && el.src){ el.imgObj = new Image(); el.imgObj.onload = pedirRender; el.imgObj.src = el.src; } });
    pedirRender(); if(historialCargado) socket.emit('sync_todo', elementos);
}

function undo() { if (historialUndo.length <= 1) return; historialRedo.push(historialUndo.pop()); aplicarEstado(historialUndo[historialUndo.length - 1]); }
function redo() { if (historialRedo.length === 0) return; const sig = historialRedo.pop(); historialUndo.push(sig); aplicarEstado(sig); }

function mostrarEditorTexto(valorInicial, callback) {
    const overlay = document.createElement('div'); overlay.id = 'text-editor-overlay'; 
    const modal = document.createElement('div'); modal.className = 'editor-modal';
    const textarea = document.createElement('textarea'); textarea.value = valorInicial; textarea.placeholder = "Escribe aquí...";
    const btn = document.createElement('button'); btn.innerText = "Guardar";
    modal.appendChild(textarea); modal.appendChild(btn); overlay.appendChild(modal); document.body.appendChild(overlay); 
    setTimeout(() => { textarea.focus(); if (valorInicial) textarea.select(); }, 100);
    const finalizar = () => { const texto = textarea.value.trim(); if (texto) callback(texto); document.body.removeChild(overlay); };
    btn.onclick = finalizar; overlay.onclick = (e) => { if(e.target === overlay) finalizar(); };
}

function actualizarListaUI() {
    const list = document.getElementById('user-list'); list.innerHTML = '';
    for (let id in cursoresData) {
        const div = document.createElement('div'); div.className = 'user-item' + (siguiendoA === id ? ' active' : ''); div.innerText = cursoresData[id].nombre;
        div.onclick = () => { if (siguiendoA === id) dejarDeSeguir(); else iniciarSeguimiento(id, cursoresData[id].nombre); }; list.appendChild(div);
    }
}

function iniciarSeguimiento(id, nombre) { siguiendoA = id; document.getElementById('follow-name').innerText = nombre; document.getElementById('follow-banner').classList.remove('hidden'); actualizarListaUI(); }
function dejarDeSeguir() { siguiendoA = null; document.getElementById('follow-banner').classList.add('hidden'); actualizarListaUI(); }
if(document.getElementById('btn-unfollow')) document.getElementById('btn-unfollow').onclick = dejarDeSeguir;

const enviarCursor = (() => { let inThrottle; return (x, y) => { if (!inThrottle) { socket.emit('mover_cursor', { x, y, nombre: miNombre }); inThrottle = true; setTimeout(() => inThrottle = false, 50); } } })();
setInterval(() => { enviarCursor(miPosicionMundo.x, miPosicionMundo.y); }, 4000);

function traerAlFrente() { if (seleccionados.length === 0) return; elementos = elementos.filter(el => !seleccionados.includes(el)); elementos.push(...seleccionados); guardarEstado(); if(historialCargado) socket.emit('sync_todo', elementos); pedirRender(); }
function enviarAlFondo() { if (seleccionados.length === 0) return; elementos = elementos.filter(el => !seleccionados.includes(el)); elementos.unshift(...seleccionados); guardarEstado(); if(historialCargado) socket.emit('sync_todo', elementos); pedirRender(); }

document.querySelectorAll('#toolbar button[id^="btn-"]').forEach(btn => {
    btn.onclick = () => {
        const id = btn.id;
        if(['btn-export', 'btn-clear', 'btn-undo', 'btn-redo', 'btn-front', 'btn-back', 'btn-home', 'btn-minimap'].includes(id)) {
            if(id==='btn-export') exportarJPG(); if(id==='btn-clear') reiniciarLienzo();
            if(id==='btn-undo') undo(); if(id==='btn-redo') redo(); if(id==='btn-front') traerAlFrente(); if(id==='btn-back') enviarAlFondo();
            if(id==='btn-home') window.location.href = 'index.html'; 
            if(id==='btn-minimap') {
                verMinimapa = !verMinimapa;
                document.getElementById('minimap-container').style.display = verMinimapa ? 'block' : 'none';
                if(verMinimapa) pedirRender();
            }
            return;
        }
        if(id === 'btn-image') { subirImagen(); return; }
        if(id === 'btn-pdf') { subirPDF(); return; } 
        
        document.querySelectorAll('#toolbar button:not(#btn-minimap)').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); modo = id.replace('btn-', ''); seleccionados = []; pedirRender();
    };
});

function getPos(e) {
    let cX, cY; if (e.touches && e.touches.length > 0) { cX = e.touches[0].clientX; cY = e.touches[0].clientY; } else { cX = e.clientX; cY = e.clientY; }
    const r = canvas.getBoundingClientRect(); const sX = canvas.width / r.width, sY = canvas.height / r.height; const sx = (cX - r.left) * sX, sy = (cY - r.top) * sY;
    return { x: (sx - camera.x) / camera.z, y: (sy - camera.y) / camera.z, rx: sx, ry: sy };
}

canvas.addEventListener('wheel', e => {
    e.preventDefault(); dejarDeSeguir();
    const zoomSensitivity = 0.001; let newZ = camera.z * Math.exp(-e.deltaY * zoomSensitivity); newZ = Math.max(0.05, Math.min(newZ, 20));
    const r = canvas.getBoundingClientRect(); const mX = (e.clientX - r.left), mY = (e.clientY - r.top);
    camera.x = mX - (mX - camera.x) * (newZ / camera.z); camera.y = mY - (mY - camera.y) * (newZ / camera.z); camera.z = newZ; pedirRender();
}, { passive: false });

const start = e => {
    const ahora = Date.now(); const dif = ahora - ultimoClickTime; ultimoClickTime = ahora;
    if(e.touches && e.touches.length > 1) { dejarDeSeguir(); isPanning = false; dibujando = false; seleccionados = []; const t1 = e.touches[0], t2 = e.touches[1]; initialPinchDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY); initialCamZ = camera.z; initialCamX = camera.x; initialCamY = camera.y; pinchCenter = { x: (t1.clientX + t2.clientX)/2, y: (t1.clientY + t2.clientY)/2 }; return; }
    isPenEraser = (e.pointerType === 'pen' && (e.buttons === 32 || e.buttons === 2 || e.button === 5));
    const m = isPenEraser ? 'erase' : modo;
    const p = getPos(e); miPosicionMundo = { x: p.x, y: p.y }; enviarCursor(p.x, p.y); 

    if(m === 'pan' || e.button === 1) { dejarDeSeguir(); isPanning = true; startPan = { x: p.rx - camera.x, y: p.ry - camera.y }; return; }
    if(m === 'erase') { borrarEn(p); return; }

    if(m === 'select') {
        let hit = null;
        for (let i = elementos.length - 1; i >= 0; i--) {
            const el = elementos[i];
            if(el.type === 'pen' && el.points.some(pt => Math.hypot(pt.x-p.x, pt.y-p.y) < (el.grosor + 15)/camera.z)) { hit = el; break; }
            else if (el.type !== 'pen') {
                const x = el.w < 0 ? el.x + el.w : el.x, y = el.h < 0 ? el.y + el.h : el.y;
                if(p.x >= x && p.x <= x + Math.abs(el.w) && p.y >= y && p.y <= y + Math.abs(el.h)) { hit = el; break; }
            }
        }

        if (dif < 300 && hit && (hit.type === 'text' || hit.type === 'sticky')) { mostrarEditorTexto(hit.text, (nuevo) => { hit.text = nuevo; guardarEstado(); if(historialCargado) socket.emit('sync_todo', elementos); pedirRender(); }); return; }

        if(hit) {
            if (!seleccionados.includes(hit)) seleccionados = [hit];
            lastMousePos = { x: p.x, y: p.y };
            if(seleccionados.length === 1 && hit.type !== 'pen' && hit.type !== 'sticky') {
                handleSeleccionado = [{x:hit.x,y:hit.y,n:'tl'},{x:hit.x+hit.w,y:hit.y,n:'tr'},{x:hit.x,y:hit.y+hit.h,n:'bl'},{x:hit.x+hit.w,y:hit.y+hit.h,n:'br'}].find(h => Math.hypot(p.x - h.x, p.y - h.y) < 30/camera.z);
            }
        } else { seleccionados = []; boxSeleccion = { startX: p.x, startY: p.y, x: p.x, y: p.y, w: 0, h: 0 }; }
        pedirRender(); return;
    }

    if(m === 'laser') { 
        dibujando = true; miLaserId = Math.random().toString(36).substr(2,9); 
        lasersActivos[miLaserId] = { color: "#ff3333", points: [{x: p.x, y: p.y, t: Date.now()}] }; 
        socket.emit('dibujar_laser', { id: miLaserId, color: "#ff3333", pt: {x: p.x, y: p.y, t: Date.now()} }); 
        return; 
    }
    
    if(m === 'sticky') { 
        mostrarEditorTexto("", (t) => { 
            const obj = { id: Math.random(), type:'sticky', x: p.x, y: p.y, text: t, color: "#fff9c4", w: 200, h: 200, grosor: 1 }; 
            elementos.push(obj); socket.emit('dibujar', obj); guardarEstado(); pedirRender(); 
        }); 
        return; 
    }
    
    if(m === 'text') { mostrarEditorTexto("", (t) => { const obj = { type:'text', x: p.x, y: p.y, text: t, color: controls.color.value, w: 120, h: 30, grosor: 2 }; elementos.push(obj); socket.emit('dibujar', obj); guardarEstado(); pedirRender(); }); return; }

    dibujando = true; 
    const col = m === 'crop' ? 'rgba(33, 150, 243, 0.3)' : controls.color.value;
    elementoActual = { id: Math.random(), type: m, x: p.x, y: p.y, w: 0, h: 0, color: col, grosor: parseInt(controls.grosor.value), points: [{x:p.x, y:p.y}] }; 
    pedirRender(); 
};

const move = e => {
    if(e.touches && e.touches.length === 2 && initialPinchDist) {
        const t1 = e.touches[0], t2 = e.touches[1]; const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        let newZ = initialCamZ * (currentDist / initialPinchDist); newZ = Math.max(0.05, Math.min(newZ, 20));
        const currentCenter = { x: (t1.clientX + t2.clientX)/2, y: (t1.clientY + t2.clientY)/2 };
        camera.x = currentCenter.x - (pinchCenter.x - initialCamX) * (newZ / initialCamZ); camera.y = currentCenter.y - (pinchCenter.y - initialCamY) * (newZ / initialCamZ); camera.z = newZ; pedirRender(); return;
    }
    if (e.type === 'touchmove' && e.touches && e.touches.length > 1) { dibujando = false; return; }

    const m = isPenEraser ? 'erase' : modo; const p = getPos(e); miPosicionMundo = { x: p.x, y: p.y };
    if(!dibujando && !isPanning) enviarCursor(p.x, p.y); 
    if(isPanning) { camera.x = p.rx - startPan.x; camera.y = p.ry - startPan.y; pedirRender(); return; }
    if(m === 'erase' && dibujando) { borrarEn(p); return; }

    if (m === 'laser' && dibujando) { const pt = {x: p.x, y: p.y, t: Date.now()}; lasersActivos[miLaserId].points.push(pt); socket.emit('dibujar_laser', { id: miLaserId, color: "#ff3333", pt: pt }); return; }
    if(dibujando && elementoActual) { if(m === 'pen') elementoActual.points.push({x: p.x, y: p.y}); else { elementoActual.w = p.x - elementoActual.x; elementoActual.h = p.y - elementoActual.y; } pedirRender(); }
    
    if(m === 'select') {
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
    isPenEraser = false; 
    
    if (boxSeleccion) {
        seleccionados = elementos.filter(el => {
            let eX, eW, eY, eH;
            if(el.type === 'pen'){ const xs = el.points.map(pt=>pt.x); eX = Math.min(...xs); eW = Math.max(...xs)-eX; const ys = el.points.map(pt=>pt.y); eY = Math.min(...ys); eH = Math.max(...ys)-eY; }
            else { eX = el.w < 0 ? el.x + el.w : el.x; eW = Math.abs(el.w); eY = el.h < 0 ? el.y + el.h : el.y; eH = Math.abs(el.h); }
            return (eX < boxSeleccion.x + boxSeleccion.w && eX + eW > boxSeleccion.x && eY < boxSeleccion.y + boxSeleccion.h && eY + eH > boxSeleccion.y);
        });
        boxSeleccion = null;
    }
    
    if (dibujando && modo === 'crop' && elementoActual) {
        const cropX = elementoActual.w < 0 ? elementoActual.x + elementoActual.w : elementoActual.x;
        const cropY = elementoActual.h < 0 ? elementoActual.y + elementoActual.h : elementoActual.y;
        const cropW = Math.abs(elementoActual.w);
        const cropH = Math.abs(elementoActual.h);

        const imgParaRecortarIndex = elementos.findLastIndex(el => 
            el.type === 'image' && 
            cropX >= el.x && cropY >= el.y && 
            cropX + cropW <= el.x + el.w && cropY + cropH <= el.y + el.h
        );

        if (imgParaRecortarIndex !== -1 && cropW > 10 && cropH > 10) {
            const imgOriginal = elementos[imgParaRecortarIndex];
            const tCanvas = document.createElement('canvas');
            tCanvas.width = cropW; tCanvas.height = cropH;
            const tCtx = tCanvas.getContext('2d');
            
            const imgEl = imgOriginal.imgObj;
            const scaleX = imgEl.width / imgOriginal.w;
            const scaleY = imgEl.height / imgOriginal.h;
            
            const srcX = (cropX - imgOriginal.x) * scaleX;
            const srcY = (cropY - imgOriginal.y) * scaleY;
            const srcW = cropW * scaleX;
            const srcH = cropH * scaleY;

            tCtx.drawImage(imgEl, srcX, srcY, srcW, srcH, 0, 0, cropW, cropH);
            
            const newSrc = tCanvas.toDataURL('image/jpeg', 0.9);
            const newImg = new Image();
            newImg.src = newSrc;
            
            newImg.onload = () => {
                const nuevoEl = { id: Math.random(), type:'image', x: cropX, y: cropY, w: cropW, h: cropH, src: newSrc, grosor: 1, imgObj: newImg };
                elementos.splice(imgParaRecortarIndex, 1);
                elementos.push(nuevoEl);
                socket.emit('sync_todo', elementos);
                guardarEstado();
                pedirRender();
            };
        }
        dibujando = false; elementoActual = null; pedirRender(); return; 
    }

    if(dibujando && elementoActual && modo !== 'crop') { elementos.push(elementoActual); socket.emit('dibujar', elementoActual); guardarEstado(); } 
    else if (cambioRealizado) { if(historialCargado) socket.emit('sync_todo', elementos); guardarEstado(); cambioRealizado = false; }
    dibujando = isPanning = false; elementoActual = null; handleSeleccionado = null; pedirRender();
};

function borrarEn(p) {
    const i = elementos.findLastIndex(el => {
        if(el.type === 'pen') return el.points.some(pt => Math.hypot(pt.x-p.x, pt.y-p.y) < (el.grosor + 15)/camera.z);
        const x = el.w < 0 ? el.x + el.w : el.x, y = el.h < 0 ? el.y + el.h : el.y; return p.x >= x && p.x <= x + Math.abs(el.w) && p.y >= y && p.y <= y + Math.abs(el.h);
    });
    if(i !== -1) { elementos.splice(i, 1); guardarEstado(); pedirRender(); if(historialCargado) socket.emit('sync_todo', elementos); }
}

function reiniciarLienzo() { if(confirm("¿Borrar todo?")) socket.emit('limpiar_todo'); }
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
        const temp = document.createElement('canvas'); temp.width = maxX - minX; temp.height = maxY - minY; const t = temp.getContext('2d'); t.fillStyle = "#fefefe"; t.fillRect(0,0,temp.width,temp.height);
        t.save(); t.translate(-minX, -minY); elementos.forEach(el => helperDibujarElemento(t, el, 1)); t.restore();
        const a = document.createElement('a'); a.download = 'Captura.jpg'; a.href = temp.toDataURL('image/jpeg', 0.9); a.click();
    }, 50);
}

function helperDibujarElemento(c, el, z) {
    c.strokeStyle = el.color; c.fillStyle = el.color; c.lineWidth = el.grosor; c.lineCap = "round"; c.lineJoin = "round";
    
    if(el.type === 'crop') {
        c.fillStyle = el.color; c.strokeStyle = "#2196F3"; c.lineWidth = 2 / z; c.setLineDash([5/z, 5/z]);
        c.fillRect(el.x, el.y, el.w, el.h); c.strokeRect(el.x, el.y, el.w, el.h); c.setLineDash([]); return;
    }

    if(el.type==='pen'){ if (el.points.length === 1) { c.beginPath(); c.arc(el.points[0].x, el.points[0].y, el.grosor / 2, 0, Math.PI * 2); c.fill(); } else { c.beginPath(); el.points.forEach((p,i)=>i===0?c.moveTo(p.x,p.y):c.lineTo(p.x,p.y)); c.stroke(); } }
    else if(el.type==='rect') c.strokeRect(el.x, el.y, el.w, el.h);
    else if(el.type==='line'){ c.beginPath(); c.moveTo(el.x, el.y); c.lineTo(el.x+el.w, el.y+el.h); c.stroke(); }
    else if(el.type==='ellipse'){ c.beginPath(); c.ellipse(el.x+el.w/2, el.y+el.h/2, Math.abs(el.w/2), Math.abs(el.h/2), 0, 0, Math.PI*2); c.stroke(); }
    else if(el.type==='text'){ c.font = "24px Arial"; c.textBaseline = "top"; const lines = el.text.split('\n'); lines.forEach((lin, i) => c.fillText(lin, el.x, el.y + (i * 28))); }
    else if(el.type==='image' && el.imgObj) c.drawImage(el.imgObj, el.x, el.y, el.w, el.h);
    else if(el.type==='sticky') { 
        c.shadowColor = 'rgba(0,0,0,0.1)'; c.shadowBlur = 10; c.fillRect(el.x, el.y, el.w, el.h); c.shadowColor = 'transparent'; 
        c.fillStyle = "#222"; c.font = "bold 18px Arial"; c.textBaseline = "top"; 
        const pars = el.text.split('\n'); let tY = el.y + 15; 
        pars.forEach(parr => { const wds = parr.split(' '); let l = ''; for(let n = 0; n < wds.length; n++) { const test = l + wds[n] + ' '; if (c.measureText(test).width > el.w - 30 && n > 0) { c.fillText(l, el.x + 15, tY); l = wds[n] + ' '; tY += 24; } else { l = test; } } c.fillText(l, el.x + 15, tY); tY += 24; }); if (tY + 15 > el.y + el.h) el.h = (tY - el.y) + 15; 
    }
}

function dibujarMinimapa() {
    if (!verMinimapa) return;
    miniCanvas.width = document.getElementById('minimap-container').clientWidth; miniCanvas.height = document.getElementById('minimap-container').clientHeight;
    mCtx.fillStyle = "#f0f0f0"; mCtx.fillRect(0, 0, miniCanvas.width, miniCanvas.height);
    if (elementos.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    elementos.forEach(el => {
        if (el.type === 'pen') { el.points.forEach(pt => { minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x); minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y); }); }
        else { const x = el.w < 0 ? el.x + el.w : el.x; const y = el.h < 0 ? el.y + el.h : el.y; minX = Math.min(minX, x); maxX = Math.max(maxX, x + Math.abs(el.w)); minY = Math.min(minY, y); maxY = Math.max(maxY, y + Math.abs(el.h)); }
    });
    
    const padding = 500; minX -= padding; minY -= padding; maxX += padding; maxY += padding;
    const mapW = maxX - minX; const mapH = maxY - minY;
    
    const scale = Math.min(miniCanvas.width / mapW, miniCanvas.height / mapH);
    const offsetX = (miniCanvas.width - mapW * scale) / 2; const offsetY = (miniCanvas.height - mapH * scale) / 2;

    mCtx.save(); mCtx.translate(offsetX, offsetY); mCtx.scale(scale, scale); mCtx.translate(-minX, -minY);
    elementos.forEach(el => helperDibujarElemento(mCtx, el, 1));

    const viewW = canvas.width / camera.z; const viewH = canvas.height / camera.z;
    const viewX = -camera.x / camera.z; const viewY = -camera.y / camera.z;
    
    mCtx.strokeStyle = "rgba(255, 0, 0, 0.8)"; mCtx.lineWidth = 2 / scale; mCtx.fillStyle = "rgba(255, 0, 0, 0.1)"; mCtx.fillRect(viewX, viewY, viewW, viewH); mCtx.strokeRect(viewX, viewY, viewW, viewH); mCtx.restore();

    miniCanvas.onclick = (e) => {
        const rect = miniCanvas.getBoundingClientRect(); const clickX = e.clientX - rect.left; const clickY = e.clientY - rect.top;
        const worldX = minX + (clickX - offsetX) / scale; const worldY = minY + (clickY - offsetY) / scale;
        camera.x = (canvas.width / 2) - (worldX * camera.z); camera.y = (canvas.height / 2) - (worldY * camera.z); pedirRender();
    };
}

function ejecutarRender() {
    renderRequerido = false; ctx.fillStyle = "#fefefe"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.translate(camera.x, camera.y); ctx.scale(camera.z, camera.z);
    ctx.strokeStyle = "#eeeeee"; ctx.lineWidth = 1 / camera.z; ctx.beginPath();
    const stp = 40; const sX = (-camera.x/camera.z) - ((-camera.x/camera.z)%stp) - stp; const sY = (-camera.y/camera.z) - ((-camera.y/camera.z)%stp) - stp;
    for(let x = sX; x < (canvas.width-camera.x)/camera.z + stp; x += stp) { ctx.moveTo(x, (-camera.y/camera.z)); ctx.lineTo(x, (canvas.height-camera.y)/camera.z); }
    for(let y = sY; y < (canvas.height-camera.y)/camera.z + stp; y += stp) { ctx.moveTo((-camera.x/camera.z), y); ctx.lineTo((canvas.width-camera.x)/camera.z, y); }
    ctx.stroke();

    [...elementos, elementoActual].forEach(el => { if(!el) return; helperDibujarElemento(ctx, el, camera.z); });

    if(modo === 'select' && seleccionados.length > 0) {
        let sMinX = Infinity, sMinY = Infinity, sMaxX = -Infinity, sMaxY = -Infinity;
        seleccionados.forEach(el => {
            if (el.type === 'pen') { el.points.forEach(pt => { sMinX = Math.min(sMinX, pt.x); sMaxX = Math.max(sMaxX, pt.x); sMinY = Math.min(sMinY, pt.y); sMaxY = Math.max(sMaxY, pt.y); }); }
            else { const x = el.w < 0 ? el.x + el.w : el.x; const y = el.h < 0 ? el.y + el.h : el.y; sMinX = Math.min(sMinX, x); sMaxX = Math.max(sMaxX, x + Math.abs(el.w)); sMinY = Math.min(sMinY, y); sMaxY = Math.max(sMaxY, y + Math.abs(el.h)); }
        });
        ctx.setLineDash([5/camera.z, 5/camera.z]); ctx.strokeStyle = "#2196F3"; ctx.lineWidth = 2/camera.z;
        ctx.strokeRect(sMinX - 5, sMinY - 5, (sMaxX - sMinX) + 10, (sMaxY - sMinY) + 10); ctx.setLineDash([]);
    }

    if (boxSeleccion) { ctx.fillStyle = "rgba(33, 150, 243, 0.1)"; ctx.strokeStyle = "#2196F3"; ctx.lineWidth = 1/camera.z; ctx.fillRect(boxSeleccion.x, boxSeleccion.y, boxSeleccion.w, boxSeleccion.h); ctx.strokeRect(boxSeleccion.x, boxSeleccion.y, boxSeleccion.w, boxSeleccion.h); }
    const now = Date.now();
    for (let id in lasersActivos) { const lr = lasersActivos[id]; lr.points = lr.points.filter(pt => now - pt.t < 1500); if (lr.points.length > 0) { ctx.beginPath(); ctx.strokeStyle = lr.color; ctx.lineWidth = 6 / camera.z; ctx.lineCap = "round"; ctx.shadowBlur = 10 / camera.z; ctx.shadowColor = lr.color; lr.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)); ctx.stroke(); ctx.shadowBlur = 0; } else delete lasersActivos[id]; }
    ctx.restore();
    dibujarMinimapa();
}

window.addEventListener('keydown', e => {
    if((e.key === 'Delete' || e.key === 'Backspace') && seleccionados.length > 0 && modo === 'select') { elementos = elementos.filter(el => !seleccionados.includes(el)); seleccionados = []; guardarEstado(); if(historialCargado) socket.emit('sync_todo', elementos); pedirRender(); }
    if(e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    if(e.ctrlKey && (e.key === 'y' || e.key === 'x')) { e.preventDefault(); redo(); }
    if(e.ctrlKey && e.key === 'ArrowUp') { e.preventDefault(); traerAlFrente(); }
    if(e.ctrlKey && e.key === 'ArrowDown') { e.preventDefault(); enviarAlFondo(); }
    if(e.ctrlKey && e.key === 'c' && seleccionados.length > 0) { portapapeles = JSON.parse(JSON.stringify(seleccionados)); }
    if(e.ctrlKey && e.key === 'v' && portapapeles.length > 0) { seleccionados = []; portapapeles.forEach(item => { let clon = JSON.parse(JSON.stringify(item)); clon.id = Math.random(); clon.x += 20; clon.y += 20; if (clon.type === 'pen') { clon.points.forEach(pt => { pt.x += 20; pt.y += 20; }); } if (clon.type === 'image' && clon.src) { clon.imgObj = new Image(); clon.imgObj.onload = pedirRender; clon.imgObj.src = clon.src; } elementos.push(clon); seleccionados.push(clon); }); guardarEstado(); if(historialCargado) socket.emit('sync_todo', elementos); pedirRender(); }
});

socket.on('dibujar', o => { if(o.type==='image'){ const i=new Image(); i.src=o.src; i.onload=()=>{o.imgObj=i; elementos.push(o); pedirRender();}; } else { elementos.push(o); pedirRender(); } });
socket.on('limpiar_todo', () => { elementos = []; camera={x:0,y:0,z:1}; guardarEstado(); pedirRender(); });
socket.on('dibujar_laser', d => { if(!lasersActivos[d.id]) lasersActivos[d.id] = { color: d.color, points: [] }; lasersActivos[d.id].points.push(d.pt); });

const cur = {};
socket.on('mover_cursor', d => {
    cursoresData[d.id] = { x: d.x, y: d.y, nombre: d.nombre, lastUpdate: Date.now() };
    if (siguiendoA === d.id) { camera.x = (canvas.width / 2) - (d.x * camera.z); camera.y = (canvas.height / 2) - (d.y * camera.z); }
    if(!cur[d.id]){ const v=document.createElement('div'); v.className='cursor-fantasma'; v.setAttribute('data-nombre', d.nombre || "Anónimo"); document.getElementById('cursores').appendChild(v); cur[d.id]=v; actualizarListaUI(); }
    cur[d.id].style.left=(d.x * camera.z + camera.x)+'px'; cur[d.id].style.top=(d.y * camera.z + camera.y)+'px'; pedirRender();
});
socket.on('borrar_cursor', id => { if(cur[id]){ cur[id].remove(); delete cur[id]; } delete cursoresData[id]; if(siguiendoA === id) dejarDeSeguir(); actualizarListaUI(); });

function subirImagen() {
    const iF = document.createElement('input'); iF.type = 'file'; iF.accept = 'image/*';
    iF.onchange = e => {
        const file = e.target.files[0]; if (!file) return; const r = new FileReader();
        r.onload = ev => { const img = new Image(); img.src = ev.target.result; img.onload = () => { const maxSize = 800; let w = img.width, h = img.height; if (w > maxSize || h > maxSize) { if (w > h) { h = (maxSize / w) * h; w = maxSize; } else { w = (maxSize / h) * w; h = maxSize; } } const tC = document.createElement('canvas'); tC.width = w; tC.height = h; const tX = tC.getContext('2d'); tX.fillStyle = "#ffffff"; tX.fillRect(0,0,w,h); tX.drawImage(img, 0, 0, w, h); const cSrc = tC.toDataURL('image/jpeg', 0.8); const fI = new Image(); fI.src = cSrc; fI.onload = () => { const vW = w > 300 ? 300 : w; const vH = (h/w)*vW; const cX = (-camera.x + canvas.width/2)/camera.z - vW/2; const cY = (-camera.y + canvas.height/2)/camera.z - vH/2; const o = { id: Math.random(), type:'image', x: cX, y: cY, w: vW, h: vH, src: cSrc, grosor: 1 }; o.imgObj = fI; elementos.push(o); socket.emit('dibujar', o); guardarEstado(); pedirRender(); }; }; }; r.readAsDataURL(file);
    }; iF.click();
}

function subirPDF() {
    if (!pdfjsLib) { alert("⚠️ La librería de PDFs aún está cargando. Intenta de nuevo en unos segundos."); return; }
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/pdf';
    input.onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        const loadingToast = document.createElement('div'); loadingToast.innerHTML = '⏳ Procesando PDF...'; loadingToast.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#2196F3; color:white; padding:10px 20px; border-radius:20px; z-index:99999; box-shadow:0 4px 10px rgba(0,0,0,0.2);'; document.body.appendChild(loadingToast);
        const fileReader = new FileReader();
        fileReader.onload = async function() {
            const typedarray = new Uint8Array(this.result); const pdf = await pdfjsLib.getDocument(typedarray).promise;
            let currentY = (-camera.y + canvas.height/2)/camera.z - 300; const startX = (-camera.x + canvas.width/2)/camera.z - 300;
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i); const viewport = page.getViewport({scale: 1.5});
                const tempCanvas = document.createElement('canvas'); const tempCtx = tempCanvas.getContext('2d'); tempCanvas.width = viewport.width; tempCanvas.height = viewport.height;
                await page.render({canvasContext: tempCtx, viewport: viewport}).promise;
                const cSrc = tempCanvas.toDataURL('image/jpeg', 0.8); const fI = new Image(); fI.src = cSrc;
                fI.onload = () => { const o = { id: Math.random(), type:'image', x: startX, y: currentY, w: viewport.width, h: viewport.height, src: cSrc, grosor: 1 }; o.imgObj = fI; elementos.push(o); socket.emit('dibujar', o); guardarEstado(); pedirRender(); currentY += viewport.height + 30; };
            }
            document.body.removeChild(loadingToast);
        }; fileReader.readAsArrayBuffer(file);
    }; input.click();
}

canvas.addEventListener('pointerdown', e => { if(e.pointerType === 'mouse' || e.pointerType === 'pen') start(e); }); canvas.addEventListener('pointermove', e => { if(e.pointerType === 'mouse' || e.pointerType === 'pen') move(e); }); window.addEventListener('pointerup', e => { if(e.pointerType === 'mouse' || e.pointerType === 'pen') end(e); });
canvas.addEventListener('touchstart', e => { e.preventDefault(); start(e); }, {passive:false}); canvas.addEventListener('touchmove', e => { e.preventDefault(); move(e); }, {passive:false}); canvas.addEventListener('touchend', e => { e.preventDefault(); end(e); }, {passive:false});
window.addEventListener('resize', () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; pedirRender(); });
guardarEstado(); requestAnimationFrame(ejecutarRender);
