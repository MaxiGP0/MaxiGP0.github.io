const pass = prompt("🔐 Ingresa la contraseña secreta:");
const miNombre = prompt("👤 Ingresa tu nombre:") || "Anónimo";

const socket = io({ auth: { password: pass } });

socket.on('connect_error', (err) => {
    alert("❌ " + err.message); window.location.reload(); 
});

const canvas = document.getElementById('pizarra');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
canvas.width = window.innerWidth; canvas.height = window.innerHeight;

let modo = 'select', elementos = [], dibujando = false, elementoActual = null;
let camera = { x: 0, y: 0, z: 1 }, isPanning = false, startPan = { x: 0, y: 0 };
let historialUndo = [], historialRedo = [];
let historialCargado = false, cambioRealizado = false; 
let initialPinchDist = null, initialCamZ = 1, initialCamX = 0, initialCamY = 0, pinchCenter = {x:0, y:0};
let seleccionados = [], boxSeleccion = null, handleSeleccionado = null, lastMousePos = { x: 0, y: 0 }; 
let lasersActivos = {}, miLaserId = null;

// --- VARIABLES PARA SEGUIR USUARIOS ---
let cursoresData = {}; // Posiciones lógicas (mundo)
let siguiendoA = null; 

const controls = { color: document.getElementById('color-picker'), grosor: document.getElementById('width-slider') };

// --- MOTOR DE RENDERIZADO ---
let renderRequerido = true; 
function pedirRender() { if (!renderRequerido) { renderRequerido = true; requestAnimationFrame(ejecutarRender); } }
setInterval(pedirRender, 1000/60); 

function throttle(func, limit) {
    let inThrottle;
    return function() { const args = arguments; if (!inThrottle) { func.apply(this, args); inThrottle = true; setTimeout(() => inThrottle = false, limit); } }
}
const enviarCursor = throttle((x, y) => { socket.emit('mover_cursor', { x, y, nombre: miNombre }); }, 50); 

function guardarEstado() { const snap = JSON.stringify(elementos.map(el => { const { imgObj, ...r } = el; return r; })); historialUndo.push(snap); if (historialUndo.length > 30) historialUndo.shift(); historialRedo = []; }
function aplicarEstado(s) { elementos = s; elementos.forEach(el => { if(el.type === 'image'){ el.imgObj = new Image(); el.imgObj.src = el.src; }}); pedirRender(); if(historialCargado) socket.emit('sync_todo', elementos); }
function undo() { if (historialUndo.length <= 1) return; historialRedo.push(historialUndo.pop()); aplicarEstado(JSON.parse(historialUndo[historialUndo.length-1])); }
function redo() { if (historialRedo.length === 0) return; const p = JSON.parse(historialRedo.pop()); historialUndo.push(JSON.stringify(p)); aplicarEstado(p); }

function traerAlFrente() { if (seleccionados.length === 0) return; elementos = elementos.filter(el => !seleccionados.includes(el)); elementos.push(...seleccionados); guardarEstado(); if(historialCargado) socket.emit('sync_todo', elementos); pedirRender(); }
function enviarAlFondo() { if (seleccionados.length === 0) return; elementos = elementos.filter(el => !seleccionados.includes(el)); elementos.unshift(...seleccionados); guardarEstado(); if(historialCargado) socket.emit('sync_todo', elementos); pedirRender(); }

function dejarDeSeguir() { siguiendoA = null; document.getElementById('follow-banner').classList.add('hidden'); }
document.getElementById('btn-unfollow').addEventListener('click', dejarDeSeguir);

function subirImagen() {
    const inputFile = document.createElement('input'); inputFile.type = 'file'; inputFile.accept = 'image/*';
    inputFile.onchange = e => {
        const file = e.target.files[0]; if (!file) return; const reader = new FileReader();
        reader.onload = ev => {
            const img = new Image(); img.src = ev.target.result;
            img.onload = () => {
                const maxSize = 800; let w = img.width, h = img.height;
                if (w > maxSize || h > maxSize) { if (w > h) { h = (maxSize / w) * h; w = maxSize; } else { w = (maxSize / h) * w; h = maxSize; } }
                const tempCanvas = document.createElement('canvas'); tempCanvas.width = w; tempCanvas.height = h;
                const tempCtx = tempCanvas.getContext('2d'); tempCtx.fillStyle = "#ffffff"; tempCtx.fillRect(0,0,w,h); tempCtx.drawImage(img, 0, 0, w, h);
                const compressedSrc = tempCanvas.toDataURL('image/jpeg', 0.8); const finalImg = new Image(); finalImg.src = compressedSrc;
                finalImg.onload = () => {
                    const visualW = w > 300 ? 300 : w; const visualH = (h / w) * visualW;
                    const centerX = (-camera.x + canvas.width / 2) / camera.z - visualW / 2; const centerY = (-camera.y + canvas.height / 2) / camera.z - visualH / 2;
                    const obj = { id: Math.random(), type:'image', x: centerX, y: centerY, w: visualW, h: visualH, src: compressedSrc, grosor: 1 };
                    obj.imgObj = finalImg; elementos.push(obj); socket.emit('dibujar', obj); guardarEstado(); pedirRender();
                };
            };
        }; reader.readAsDataURL(file);
    }; inputFile.click();
}

document.querySelectorAll('#toolbar button[id^="btn-"]').forEach(btn => {
    btn.addEventListener('click', () => {
        const id = btn.id;
        if(id === 'btn-export') { exportarJPG(); return; } if(id === 'btn-save') { guardarLocal(); return; }
        if(id === 'btn-load') { cargarLocal(); return; } if(id === 'btn-clear') { reiniciarLienzo(); return; }
        if(id === 'btn-zoom_reset') { camera = {x:0, y:0, z:1}; pedirRender(); return; }
        if(id === 'btn-undo') { undo(); return; } if(id === 'btn-redo') { redo(); return; }
        if(id === 'btn-front') { traerAlFrente(); return; } if(id === 'btn-back') { enviarAlFondo(); return; }
        if(id === 'btn-image') { subirImagen(); document.querySelectorAll('#toolbar button').forEach(b => b.classList.remove('active')); btn.classList.add('active'); modo = 'select'; seleccionados = []; pedirRender(); return; } 
        document.querySelectorAll('#toolbar button').forEach(b => b.classList.remove('active')); btn.classList.add('active'); modo = id.replace('btn-', ''); seleccionados = []; pedirRender();
    });
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

function obtenerHandles(el) {
    if (el.type === 'pen' || el.type === 'sticky') return [];
    return [{x: el.x, y: el.y, n: 'tl'}, {x: el.x + el.w, y: el.y, n: 'tr'}, {x: el.x, y: el.y + el.h, n: 'bl'}, {x: el.x + el.w, y: el.y + el.h, n: 'br'}];
}

const start = e => {
    if(e.touches && e.touches.length === 2) {
        dejarDeSeguir(); isPanning = false; dibujando = false; seleccionados = [];
        const t1 = e.touches[0], t2 = e.touches[1]; initialPinchDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        initialCamZ = camera.z; initialCamX = camera.x; initialCamY = camera.y; pinchCenter = { x: (t1.clientX + t2.clientX)/2, y: (t1.clientY + t2.clientY)/2 }; return;
    }

    const p = getPos(e);
    if(modo === 'pan' || e.button === 1) { dejarDeSeguir(); isPanning = true; startPan = { x: p.rx - camera.x, y: p.ry - camera.y }; return; }
    if(modo === 'erase') { borrarEn(p); return; }

    if(modo === 'select') {
        // FIX: Detectar si clicamos sobre un cursor ajeno (Seguir usuario)
        for (let id in cursoresData) {
            const c = cursoresData[id];
            // Distancia entre el clic y la posición del amigo en el lienzo (mundo)
            if (Math.hypot(p.x - c.x, p.y - c.y) < 30 / camera.z) {
                siguiendoA = id;
                document.getElementById('follow-name').innerText = c.nombre;
                document.getElementById('follow-banner').classList.remove('hidden');
                seleccionados = []; pedirRender(); return; 
            }
        }

        if(seleccionados.length === 1) {
            const radioAcierto = 30 / camera.z; 
            handleSeleccionado = obtenerHandles(seleccionados[0]).find(h => Math.hypot(p.x - h.x, p.y - h.y) < radioAcierto);
            if(handleSeleccionado) return;
        }
        
        const hit = elementos.slice().reverse().find(el => {
            if(el.type === 'pen') return el.points.some(pt => Math.hypot(pt.x-p.x, pt.y-p.y) < (el.grosor + 15)/camera.z);
            const x = el.w < 0 ? el.x + el.w : el.x, y = el.h < 0 ? el.y + el.h : el.y;
            return p.x >= x && p.x <= x + Math.abs(el.w) && p.y >= y && p.y <= y + Math.abs(el.h);
        });

        if(hit) { if (!seleccionados.includes(hit)) seleccionados = [hit]; lastMousePos = { x: p.x, y: p.y }; } 
        else { seleccionados = []; boxSeleccion = { startX: p.x, startY: p.y, x: p.x, y: p.y, w: 0, h: 0 }; }
        pedirRender(); return;
    }

    if (modo === 'laser') {
        dibujando = true; miLaserId = Math.random().toString(36).substr(2, 9);
        lasersActivos[miLaserId] = { color: controls.color.value, points: [{x: p.x, y: p.y, t: Date.now()}] };
        socket.emit('dibujar_laser', { id: miLaserId, color: controls.color.value, pt: {x: p.x, y: p.y, t: Date.now()} }); return;
    }

    if(modo === 'sticky') {
        const t = prompt("Texto de la Nota:");
        if(t) { const color = controls.color.value; const obj = { id: Math.random(), type:'sticky', x: p.x, y: p.y, text: t, color: color, w: 200, h: 200, grosor: 1 };
            elementos.push(obj); socket.emit('dibujar', obj); guardarEstado(); pedirRender(); } return;
    }

    if(modo === 'text') {
        const t = prompt("Escribe tu texto:");
        if(t) { const obj = { type:'text', x: p.x, y: p.y, text: t, color: controls.color.value, w: 120, h: 30, grosor: 2 };
            elementos.push(obj); socket.emit('dibujar', obj); guardarEstado(); pedirRender(); } return;
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
        } else if(handleSeleccionado && seleccionados.length === 1) {
            const h = handleSeleccionado.n, el = seleccionados[0];
            if(h.includes('r')) el.w = p.x - el.x; if(h.includes('l')) { el.w += el.x - p.x; el.x = p.x; }
            if(h.includes('b')) el.h = p.y - el.y; if(h.includes('t')) { el.h += el.y - p.y; el.y = p.y; }
            cambioRealizado = true;
        } else if (seleccionados.length > 0 && (e.buttons === 1 || e.touches)) {
            const dx = p.x - lastMousePos.x; const dy = p.y - lastMousePos.y;
            seleccionados.forEach(el => {
                if (el.type === 'pen') { el.points.forEach(pt => { pt.x += dx; pt.y += dy; }); } else { el.x += dx; el.y += dy; }
            });
            lastMousePos = { x: p.x, y: p.y }; cambioRealizado = true;
        }
        pedirRender();
    }
};

const end = e => {
    if(e && e.touches && e.touches.length < 2) initialPinchDist = null;
    if (boxSeleccion) {
        seleccionados = elementos.filter(el => {
            let elMinX, elMaxX, elMinY, elMaxY;
            if (el.type === 'pen') {
                const xs = el.points.map(pt => pt.x); const ys = el.points.map(pt => pt.y);
                elMinX = Math.min(...xs); elMaxX = Math.max(...xs); elMinY = Math.min(...ys); elMaxY = Math.max(...ys);
            } else {
                elMinX = el.w < 0 ? el.x + el.w : el.x; elMaxX = elMinX + Math.abs(el.w);
                elMinY = el.h < 0 ? el.y + el.h : el.y; elMaxY = elMinY + Math.abs(el.h);
            }
            return (elMinX < boxSeleccion.x + boxSeleccion.w && elMaxX > boxSeleccion.x && elMinY < boxSeleccion.y + boxSeleccion.h && elMaxY > boxSeleccion.y);
        });
        boxSeleccion = null;
    }
    if(dibujando && elementoActual) { elementos.push(elementoActual); socket.emit('dibujar', elementoActual); guardarEstado(); cambioRealizado = false; } 
    else if (cambioRealizado) { if(historialCargado) socket.emit('sync_todo', elementos); guardarEstado(); cambioRealizado = false; }
    dibujando = isPanning = false; elementoActual = null; handleSeleccionado = null; pedirRender();
};

canvas.addEventListener('wheel', e => {
    e.preventDefault(); dejarDeSeguir();
    const zoomSensitivity = 0.001; let newZ = camera.z * Math.exp(-e.deltaY * zoomSensitivity); newZ = Math.max(0.1, Math.min(newZ, 10));
    const rect = canvas.getBoundingClientRect(); const mouseX = e.clientX - rect.left, mouseY = e.clientY - rect.top;
    camera.x = mouseX - (mouseX - camera.x) * (newZ / camera.z); camera.y = mouseY - (mouseY - camera.y) * (newZ / camera.z); camera.z = newZ; pedirRender();
}, { passive: false });

function borrarEn(p) {
    const i = elementos.findLastIndex(el => {
        if(el.type === 'pen') return el.points.some(pt => Math.hypot(pt.x-p.x, pt.y-p.y) < (el.grosor + 15)/camera.z);
        const x = el.w < 0 ? el.x + el.w : el.x, y = el.h < 0 ? el.y + el.h : el.y;
        return p.x >= x && p.x <= x + Math.abs(el.w) && p.y >= y && p.y <= y + Math.abs(el.h);
    });
    if(i !== -1) { elementos.splice(i, 1); guardarEstado(); pedirRender(); if(historialCargado) socket.emit('sync_todo', elementos); }
}

function reiniciarLienzo() { if(confirm("¿Borrar todo?")) socket.emit('limpiar_todo'); }

// --- EXPORTACIÓN PANORÁMICA MEJORADA ---
function exportarJPG() {
    seleccionados = []; pedirRender();
    setTimeout(() => {
        if (elementos.length === 0) return alert("Pizarra vacía.");
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        elementos.forEach(el => {
            if (el.type === 'pen') {
                el.points.forEach(pt => {
                    minX = Math.min(minX, pt.x - el.grosor); maxX = Math.max(maxX, pt.x + el.grosor);
                    minY = Math.min(minY, pt.y - el.grosor); maxY = Math.max(maxY, pt.y + el.grosor);
                });
            } else {
                let x = el.x, y = el.y, w = el.w, h = el.h;
                if (w < 0) { x += w; w = Math.abs(w); } if (h < 0) { y += h; h = Math.abs(h); }
                minX = Math.min(minX, x); maxX = Math.max(maxX, x + w);
                minY = Math.min(minY, y); maxY = Math.max(maxY, y + h);
            }
        });
        const pad = 100; minX -= pad; minY -= pad; maxX += pad; maxY += pad;
        const eW = maxX - minX, eH = maxY - minY; if(eW <= 0 || eH <= 0) return;
        const temp = document.createElement('canvas'); temp.width = eW; temp.height = eH;
        const t = temp.getContext('2d'); t.fillStyle = "#fefefe"; t.fillRect(0,0,eW,eH);
        t.save(); t.translate(-minX, -minY); elementos.forEach(el => helperDibujarElemento(t, el, 1)); t.restore();
        const a = document.createElement('a'); a.download = 'Pizarra_Completa.jpg'; a.href = temp.toDataURL('image/jpeg', 0.9); a.click();
    }, 50);
}

function helperDibujarElemento(c, el, z) {
    c.strokeStyle = el.color; c.fillStyle = el.color; c.lineWidth = el.grosor; c.lineCap = "round"; c.lineJoin = "round";
    if(el.type==='pen'){ c.beginPath(); el.points.forEach((p,i)=>i===0?c.moveTo(p.x,p.y):c.lineTo(p.x,p.y)); c.stroke(); }
    else if(el.type==='rect') c.strokeRect(el.x, el.y, el.w, el.h);
    else if(el.type==='line'){ c.beginPath(); c.moveTo(el.x, el.y); c.lineTo(el.x+el.w, el.y+el.h); c.stroke(); }
    else if(el.type==='ellipse'){ c.beginPath(); c.ellipse(el.x+el.w/2, el.y+el.h/2, Math.abs(el.w/2), Math.abs(el.h/2), 0, 0, Math.PI*2); c.stroke(); }
    else if(el.type==='text'){ c.font = "24px Arial"; c.textBaseline = "top"; c.fillText(el.text, el.x, el.y); }
    else if(el.type==='image' && el.imgObj) c.drawImage(el.imgObj, el.x, el.y, el.w, el.h);
    else if(el.type==='sticky') {
        c.shadowColor = 'rgba(0,0,0,0.15)'; c.shadowBlur = 10; c.shadowOffsetX = 3; c.shadowOffsetY = 3;
        c.fillRect(el.x, el.y, el.w, el.h); c.shadowColor = 'transparent';
        c.fillStyle = "#222"; c.font = "bold 18px Arial"; c.textBaseline = "top";
        const wds = el.text.split(' '); let l = ''; let tY = el.y + 15;
        for(let n = 0; n < wds.length; n++) {
            const tL = l + wds[n] + ' ';
            if (c.measureText(tL).width > el.w - 30 && n > 0) { c.fillText(l, el.x + 15, tY); l = wds[n] + ' '; tY += 24; } 
            else { l = tL; }
        }
        c.fillText(l, el.x + 15, tY);
        if (tY + 30 > el.y + el.h) el.h = (tY - el.y) + 30; 
    }
}

function ejecutarRender() {
    renderRequerido = false; 
    ctx.fillStyle = "#fefefe"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.translate(camera.x, camera.y); ctx.scale(camera.z, camera.z);
    
    const l = -camera.x / camera.z, t = -camera.y / camera.z;
    const r = (canvas.width - camera.x) / camera.z, b = (canvas.height - camera.y) / camera.z;

    ctx.strokeStyle = "#eeeeee"; ctx.lineWidth = 1 / camera.z; ctx.beginPath();
    const stp = 40; const sX = l - (l % stp) - stp, sY = t - (t % stp) - stp;
    for(let x = sX; x < r + stp; x += stp){ ctx.moveTo(x, t); ctx.lineTo(x, b); }
    for(let y = sY; y < b + stp; y += stp){ ctx.moveTo(l, y); ctx.lineTo(r, y); }
    ctx.stroke();

    [...elementos, elementoActual].forEach(el => {
        if(!el) return;
        if (el.type !== 'pen' && el.type !== 'line') {
            const minX = Math.min(el.x, el.x + el.w); const maxX = Math.max(el.x, el.x + el.w);
            const minY = Math.min(el.y, el.y + el.h); const maxY = Math.max(el.y, el.y + el.h);
            if (maxX < l || minX > r || maxY < t || minY > b) return; 
        }
        helperDibujarElemento(ctx, el, camera.z);
        if(modo==='select' && seleccionados.includes(el)){
            ctx.setLineDash([5/camera.z, 5/camera.z]); ctx.strokeStyle = "#2196F3"; ctx.lineWidth = 2/camera.z;
            if (el.type === 'pen') {
                const xs = el.points.map(pt => pt.x); const ys = el.points.map(pt => pt.y);
                const mxX = Math.min(...xs), maX = Math.max(...xs), mxY = Math.min(...ys), maY = Math.max(...ys);
                ctx.strokeRect(mxX-5, mxY-5, (maX-mxX)+10, (maY-mxY)+10);
            } else { ctx.strokeRect(el.x, el.y, el.w, el.h); }
            ctx.setLineDash([]); ctx.fillStyle = "#2196F3";
            if (seleccionados.length === 1 && el.type !== 'pen' && el.type !== 'sticky') {
                const hS = 10 / camera.z; obtenerHandles(el).forEach(h => { ctx.fillRect(h.x - hS/2, h.y - hS/2, hS, hS); });
            }
        }
    });

    if (boxSeleccion) { ctx.fillStyle = "rgba(33, 150, 243, 0.1)"; ctx.strokeStyle = "#2196F3"; ctx.lineWidth = 1/camera.z; ctx.fillRect(boxSeleccion.x, boxSeleccion.y, boxSeleccion.w, boxSeleccion.h); ctx.strokeRect(boxSeleccion.x, boxSeleccion.y, boxSeleccion.w, boxSeleccion.h); }

    const now = Date.now();
    for (let id in lasersActivos) {
        const lr = lasersActivos[id]; lr.points = lr.points.filter(pt => now - pt.t < 1500);
        if (lr.points.length > 0) {
            ctx.beginPath(); ctx.strokeStyle = lr.color; ctx.lineWidth = 6 / camera.z; ctx.lineCap = "round"; ctx.lineJoin = "round";
            ctx.shadowBlur = 10 / camera.z; ctx.shadowColor = lr.color;
            lr.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
            ctx.stroke(); ctx.shadowBlur = 0; 
        } else { delete lasersActivos[id]; }
    }
    ctx.restore();
}

window.addEventListener('keydown', e => {
    if((e.key === 'Delete' || e.key === 'Backspace') && seleccionados.length > 0 && modo === 'select') {
        elementos = elementos.filter(el => !seleccionados.includes(el));
        seleccionados = []; guardarEstado(); pedirRender(); if(historialCargado) socket.emit('sync_todo', elementos);
    }
    if(e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    if(e.ctrlKey && (e.key === 'y' || e.key === 'x')) { e.preventDefault(); redo(); }
    if(e.ctrlKey && e.key === 'ArrowUp') { e.preventDefault(); traerAlFrente(); }
    if(e.ctrlKey && e.key === 'ArrowDown') { e.preventDefault(); enviarAlFondo(); }
});

socket.on('dibujar', o => {
    if(o.type==='image'){ const i=new Image(); i.src=o.src; i.onload=()=>{o.imgObj=i; elementos.push(o); pedirRender();}; }
    else { elementos.push(o); pedirRender(); }
});
socket.on('cargar_historial', h => {
    elementos = h; historialCargado = true;
    elementos.forEach(el=>{if(el.type==='image'){el.imgObj=new Image(); el.imgObj.src=el.src; el.imgObj.onload=pedirRender;}});
    pedirRender(); if(historialUndo.length===0) guardarEstado();
});
socket.on('limpiar_todo', () => { elementos = []; seleccionados=[]; camera={x:0,y:0,z:1}; guardarEstado(); pedirRender(); });
socket.on('dibujar_laser', data => { if(!lasersActivos[data.id]) lasersActivos[data.id] = { color: data.color, points: [] }; lasersActivos[data.id].points.push(data.pt); });

const cur = {};
socket.on('mover_cursor', d => {
    // FIX: Actualizar data lógica del cursor para hit detection de "Seguir"
    cursoresData[d.id] = { x: d.x, y: d.y, nombre: d.nombre };

    // Si estamos siguiendo a este usuario, centramos la cámara suavemente
    if (siguiendoA === d.id) {
        camera.x = (canvas.width / 2) - (d.x * camera.z);
        camera.y = (canvas.height / 2) - (d.y * camera.z);
    }

    if(!cur[d.id]){ 
        const v=document.createElement('div'); v.className='cursor-fantasma'; 
        v.setAttribute('data-nombre', d.nombre || "Anónimo"); 
        document.getElementById('cursores').appendChild(v); cur[d.id]=v; 
    }
    // Traducir de posición lógica a posición visual en pantalla
    cur[d.id].style.left=(d.x * camera.z + camera.x)+'px'; cur[d.id].style.top=(d.y * camera.z + camera.y)+'px';
    pedirRender();
});

socket.on('borrar_cursor', id => { 
    if(cur[id]){ cur[id].remove(); delete cur[id]; }
    delete cursoresData[id]; 
    if(siguiendoA === id) dejarDeSeguir();
});

canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
canvas.addEventListener('touchstart', e => { e.preventDefault(); start(e); }, {passive:false});
canvas.addEventListener('touchmove', e => { e.preventDefault(); move(e); }, {passive:false});
canvas.addEventListener('touchend', e => { e.preventDefault(); end(e); }, {passive:false});
canvas.addEventListener('touchcancel', e => { e.preventDefault(); end(e); }, {passive:false});

let lastW = window.innerWidth;
window.addEventListener('resize', () => {
    const isM = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isM && window.innerWidth === lastW) return; 
    lastW = window.innerWidth; canvas.width = window.innerWidth; canvas.height = window.innerHeight; pedirRender();
});
guardarEstado(); requestAnimationFrame(ejecutarRender);
