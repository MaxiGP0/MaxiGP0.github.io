const pass = prompt("🔐 Ingresa la contraseña secreta para entrar al cuaderno:");
const socket = io({ auth: { password: pass } });

socket.on('connect_error', (err) => {
    alert("❌ " + err.message);
    window.location.reload(); 
});

const canvas = document.getElementById('pizarra');
// FIX GRÁFICO: willReadFrequently evita el parpadeo de pantalla en celulares
const ctx = canvas.getContext('2d', { willReadFrequently: true });

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let modo = 'select', elementos = [], dibujando = false, seleccionado = null, elementoActual = null;
let camera = { x: 0, y: 0, z: 1 }, isPanning = false, startPan = { x: 0, y: 0 };
let handleSeleccionado = null, historialUndo = [], historialRedo = [];

let historialCargado = false, cambioRealizado = false; 
let initialPinchDist = null, initialCamZ = 1, initialCamX = 0, initialCamY = 0, pinchCenter = {x:0, y:0};

const controls = { color: document.getElementById('color-picker'), grosor: document.getElementById('width-slider') };

// --- MOTOR DE RENDERIZADO (Game Loop para fluidez a 60 FPS) ---
let renderRequerido = true; 

function pedirRender() {
    if (!renderRequerido) {
        renderRequerido = true;
        requestAnimationFrame(ejecutarRender);
    }
}

function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}
const enviarCursor = throttle((x, y) => { socket.emit('mover_cursor', { x, y }); }, 50); 

function guardarEstado() {
    const snap = JSON.stringify(elementos.map(el => { const { imgObj, ...r } = el; return r; }));
    historialUndo.push(snap);
    if (historialUndo.length > 30) historialUndo.shift();
    historialRedo = [];
}

function aplicarEstado(s) {
    elementos = s;
    elementos.forEach(el => { if(el.type === 'image'){ el.imgObj = new Image(); el.imgObj.src = el.src; el.imgObj.onload = pedirRender; }});
    pedirRender();
    if(historialCargado) socket.emit('sync_todo', elementos);
}

function undo() {
    if (historialUndo.length <= 1) return;
    historialRedo.push(historialUndo.pop());
    aplicarEstado(JSON.parse(historialUndo[historialUndo.length-1]));
}

function redo() {
    if (historialRedo.length === 0) return;
    const p = JSON.parse(historialRedo.pop());
    historialUndo.push(JSON.stringify(p));
    aplicarEstado(p);
}

function subirImagen() {
    const inputFile = document.createElement('input');
    inputFile.type = 'file';
    inputFile.accept = 'image/*';

    inputFile.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = ev => {
            const img = new Image();
            img.src = ev.target.result;
            img.onload = () => {
                const maxSize = 800; 
                let w = img.width;
                let h = img.height;

                if (w > maxSize || h > maxSize) {
                    if (w > h) { h = (maxSize / w) * h; w = maxSize; } 
                    else { w = (maxSize / h) * w; h = maxSize; }
                }

                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = w; tempCanvas.height = h;
                const tempCtx = tempCanvas.getContext('2d');
                
                tempCtx.fillStyle = "#ffffff";
                tempCtx.fillRect(0,0,w,h);
                tempCtx.drawImage(img, 0, 0, w, h);

                const compressedSrc = tempCanvas.toDataURL('image/jpeg', 0.8);

                const finalImg = new Image();
                finalImg.src = compressedSrc;
                finalImg.onload = () => {
                    const visualW = w > 300 ? 300 : w;
                    const visualH = (h / w) * visualW;
                    const centerX = (-camera.x + canvas.width / 2) / camera.z - visualW / 2;
                    const centerY = (-camera.y + canvas.height / 2) / camera.z - visualH / 2;

                    const obj = { id: Math.random(), type:'image', x: centerX, y: centerY, w: visualW, h: visualH, src: compressedSrc, grosor: 1 };
                    obj.imgObj = finalImg; 
                    elementos.push(obj); 
                    socket.emit('dibujar', obj); 
                    guardarEstado(); 
                    pedirRender();
                };
            };
        };
        reader.readAsDataURL(file);
    };
    inputFile.click();
}

document.querySelectorAll('#toolbar button[id^="btn-"]').forEach(btn => {
    btn.addEventListener('click', () => {
        const id = btn.id;
        if(id === 'btn-export') exportarJPG();
        else if(id === 'btn-save') guardarLocal();
        else if(id === 'btn-load') cargarLocal();
        else if(id === 'btn-clear') reiniciarLienzo();
        else if(id === 'btn-zoom_reset') { camera = {x:0, y:0, z:1}; pedirRender(); }
        else if(id === 'btn-undo') undo(); 
        else if(id === 'btn-redo') redo(); 
        else if(id === 'btn-image') {
            subirImagen(); 
            document.querySelectorAll('#toolbar button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            modo = 'select'; 
            seleccionado = null; pedirRender();
        }
        else {
            document.querySelectorAll('#toolbar button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            modo = id.replace('btn-', '');
            seleccionado = null; pedirRender();
        }
    });
});

// FIX LÁPIZ DIGITAL: Coordenadas precisas para que la tinta salga de la punta
function getPos(e) {
    let clientX, clientY;
    
    // Identificar si el evento viene de un dedo (Touch) o Ratón/Lápiz
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX; 
        clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX; 
        clientY = e.changedTouches[0].clientY;
    } else {
        clientX = e.clientX; 
        clientY = e.clientY;
    }

    const rect = canvas.getBoundingClientRect();
    
    // Restamos el margen del canvas para obtener la posición real
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    
    return { 
        x: (sx - camera.x) / camera.z, 
        y: (sy - camera.y) / camera.z, 
        rx: sx, 
        ry: sy 
    };
}

function obtenerHandles(el) {
    if (el.type === 'pen') return [];
    return [
        {x: el.x, y: el.y, n: 'tl'}, {x: el.x + el.w, y: el.y, n: 'tr'},
        {x: el.x, y: el.y + el.h, n: 'bl'}, {x: el.x + el.w, y: el.y + el.h, n: 'br'}
    ];
}

const start = e => {
    if(e.touches && e.touches.length === 2) {
        isPanning = false; dibujando = false; seleccionado = null;
        const t1 = e.touches[0], t2 = e.touches[1];
        initialPinchDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        initialCamZ = camera.z; initialCamX = camera.x; initialCamY = camera.y;
        pinchCenter = { x: (t1.clientX + t2.clientX)/2, y: (t1.clientY + t2.clientY)/2 };
        return;
    }

    const p = getPos(e);
    if(modo === 'pan' || e.button === 1) { isPanning = true; startPan = { x: p.rx - camera.x, y: p.ry - camera.y }; return; }
    if(modo === 'erase') { borrarEn(p); return; }

    if(modo === 'select') {
        if(seleccionado) {
            const radioAcierto = 30 / camera.z; 
            handleSeleccionado = obtenerHandles(seleccionado).find(h => Math.hypot(p.x - h.x, p.y - h.y) < radioAcierto);
            if(handleSeleccionado) return;
        }
        
        seleccionado = elementos.slice().reverse().find(el => {
            if(el.type === 'pen') return el.points.some(pt => Math.hypot(pt.x-p.x, pt.y-p.y) < (el.grosor + 15)/camera.z);
            const x = el.w < 0 ? el.x + el.w : el.x, y = el.h < 0 ? el.y + el.h : el.y;
            return p.x >= x && p.x <= x + Math.abs(el.w) && p.y >= y && p.y <= y + Math.abs(el.h);
        });

        if(seleccionado) { seleccionado.ox = p.x - seleccionado.x; seleccionado.oy = p.y - seleccionado.y; }
        pedirRender(); return;
    }

    if(modo === 'text') {
        const t = prompt("Escribe tu texto:");
        if(t) { 
            const obj = { type:'text', x: p.x, y: p.y, text: t, color: controls.color.value, w: 120, h: 30, grosor: 2 };
            elementos.push(obj); socket.emit('dibujar', obj); guardarEstado(); pedirRender(); 
        }
        return;
    }

    dibujando = true;
    elementoActual = { 
        id: Math.random(), type: modo, x: p.x, y: p.y, w: 0, h: 0, 
        color: controls.color.value, grosor: parseInt(controls.grosor.value), points: [{x:p.x, y:p.y}] 
    };
};

const move = e => {
    if(e.touches && e.touches.length === 2 && initialPinchDist) {
        const t1 = e.touches[0], t2 = e.touches[1];
        const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        let newZ = initialCamZ * (currentDist / initialPinchDist);
        newZ = Math.max(0.1, Math.min(newZ, 10));

        const currentCenter = { x: (t1.clientX + t2.clientX)/2, y: (t1.clientY + t2.clientY)/2 };
        camera.x = currentCenter.x - (pinchCenter.x - initialCamX) * (newZ / initialCamZ);
        camera.y = currentCenter.y - (pinchCenter.y - initialCamY) * (newZ / initialCamZ);
        camera.z = newZ;
        pedirRender(); return;
    }

    const p = getPos(e);
    if(!dibujando && !isPanning) enviarCursor(p.x, p.y); 

    if(isPanning) { camera.x = p.rx - startPan.x; camera.y = p.ry - startPan.y; pedirRender(); return; }

    if(dibujando && elementoActual) {
        if(modo === 'pen') elementoActual.points.push({x: p.x, y: p.y});
        else { elementoActual.w = p.x - elementoActual.x; elementoActual.h = p.y - elementoActual.y; }
        pedirRender();
    }

    if(modo === 'select' && seleccionado) {
        if(handleSeleccionado) {
            const h = handleSeleccionado.n, el = seleccionado;
            if(h.includes('r')) el.w = p.x - el.x; if(h.includes('l')) { el.w += el.x - p.x; el.x = p.x; }
            if(h.includes('b')) el.h = p.y - el.y; if(h.includes('t')) { el.h += el.y - p.y; el.y = p.y; }
            cambioRealizado = true;
        } else if (e.buttons === 1 || e.touches) {
            seleccionado.x = p.x - seleccionado.ox; 
            seleccionado.y = p.y - seleccionado.oy;
            cambioRealizado = true;
        }
        pedirRender();
    }
};

const end = e => {
    if(e && e.touches && e.touches.length < 2) initialPinchDist = null;

    if(dibujando && elementoActual) { 
        elementos.push(elementoActual); socket.emit('dibujar', elementoActual); 
        guardarEstado(); cambioRealizado = false;
    } else if (cambioRealizado) { 
        if(historialCargado) socket.emit('sync_todo', elementos); 
        guardarEstado(); cambioRealizado = false;
    }
    dibujando = isPanning = false; elementoActual = null; handleSeleccionado = null;
    pedirRender();
};

canvas.addEventListener('wheel', e => {
    e.preventDefault(); 
    const zoomSensitivity = 0.001;
    let newZ = camera.z * Math.exp(-e.deltaY * zoomSensitivity);
    newZ = Math.max(0.1, Math.min(newZ, 10));

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left, mouseY = e.clientY - rect.top;

    camera.x = mouseX - (mouseX - camera.x) * (newZ / camera.z);
    camera.y = mouseY - (mouseY - camera.y) * (newZ / camera.z);
    camera.z = newZ; pedirRender();
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

function exportarJPG() {
    seleccionado = null; pedirRender();
    setTimeout(() => {
        const temp = document.createElement('canvas'); temp.width = canvas.width; temp.height = canvas.height;
        const t = temp.getContext('2d');
        t.fillStyle = "#fefefe"; t.fillRect(0,0,temp.width,temp.height); t.drawImage(canvas, 0, 0);
        const a = document.createElement('a'); a.download = 'dibujo.jpg'; a.href = temp.toDataURL('image/jpeg', 0.9); a.click();
    }, 50);
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

function ejecutarRender() {
    renderRequerido = false; 

    ctx.fillStyle = "#fefefe";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.save(); ctx.translate(camera.x, camera.y); ctx.scale(camera.z, camera.z);
    
    const left = -camera.x / camera.z, top = -camera.y / camera.z;
    const right = (canvas.width - camera.x) / camera.z, bottom = (canvas.height - camera.y) / camera.z;

    ctx.strokeStyle = "#eeeeee"; ctx.lineWidth = 1 / camera.z; ctx.beginPath();
    const step = 40, startX = left - (left % step) - step, startY = top - (top % step) - step;

    for(let x = startX; x < right + step; x += step){ ctx.moveTo(x, top); ctx.lineTo(x, bottom); }
    for(let y = startY; y < bottom + step; y += step){ ctx.moveTo(left, y); ctx.lineTo(right, y); }
    ctx.stroke();

    [...elementos, elementoActual].forEach(el => {
        if(!el) return;
        ctx.strokeStyle = el.color; ctx.fillStyle = el.color; ctx.lineWidth = el.grosor; ctx.lineCap = "round";
        
        // Optimización: No dibujar si está muy fuera de pantalla
        if (el.type !== 'pen' && el.type !== 'line') {
            const minX = Math.min(el.x, el.x + el.w); const maxX = Math.max(el.x, el.x + el.w);
            const minY = Math.min(el.y, el.y + el.h); const maxY = Math.max(el.y, el.y + el.h);
            if (maxX < left || minX > right || maxY < top || minY > bottom) return; 
        }

        if(el.type==='pen'){ ctx.beginPath(); el.points.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y)); ctx.stroke(); }
        else if(el.type==='rect') ctx.strokeRect(el.x, el.y, el.w, el.h);
        else if(el.type==='line'){ ctx.beginPath(); ctx.moveTo(el.x, el.y); ctx.lineTo(el.x+el.w, el.y+el.h); ctx.stroke(); }
        else if(el.type==='ellipse'){ ctx.beginPath(); ctx.ellipse(el.x+el.w/2, el.y+el.h/2, Math.abs(el.w/2), Math.abs(el.h/2), 0, 0, Math.PI*2); ctx.stroke(); }
        else if(el.type==='text'){ ctx.font = "24px Arial"; ctx.textBaseline = "top"; ctx.fillText(el.text, el.x, el.y); }
        else if(el.type==='image' && el.imgObj) ctx.drawImage(el.imgObj, el.x, el.y, el.w, el.h);
        
        if(modo==='select' && el === seleccionado && el.type !== 'pen'){
            ctx.setLineDash([5/camera.z, 5/camera.z]); ctx.strokeStyle = "#2196F3"; ctx.lineWidth = 2/camera.z;
            ctx.strokeRect(el.x, el.y, el.w, el.h);
            ctx.setLineDash([]); ctx.fillStyle = "#2196F3";
            const hSize = 10 / camera.z; 
            obtenerHandles(el).forEach(h => { ctx.fillRect(h.x - hSize/2, h.y - hSize/2, hSize, hSize); });
        }
    });
    ctx.restore();
}

window.addEventListener('keydown', e => {
    if(e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    if(e.ctrlKey && (e.key === 'y' || e.key === 'x')) { e.preventDefault(); redo(); }
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
socket.on('limpiar_todo', () => { elementos = []; camera={x:0,y:0,z:1}; guardarEstado(); pedirRender(); });

const cur = {};
socket.on('mover_cursor', d => {
    if(!cur[d.id]){ const v=document.createElement('div'); v.className='cursor-fantasma'; document.getElementById('cursores').appendChild(v); cur[d.id]=v; }
    cur[d.id].style.left=(d.x * camera.z + camera.x)+'px'; cur[d.id].style.top=(d.y * camera.z + camera.y)+'px';
});
socket.on('borrar_cursor', id => { if(cur[id]){ cur[id].remove(); delete cur[id]; }});

// FIX MÓVIL: Control absoluto de los eventos táctiles directamente sobre el canvas
canvas.addEventListener('mousedown', start); 
canvas.addEventListener('mousemove', move); 
window.addEventListener('mouseup', end);

canvas.addEventListener('touchstart', e => { 
    e.preventDefault(); 
    start(e); 
}, {passive:false});

canvas.addEventListener('touchmove', e => { 
    e.preventDefault(); 
    move(e); 
}, {passive:false});

canvas.addEventListener('touchend', e => { e.preventDefault(); end(e); }, {passive:false});
canvas.addEventListener('touchcancel', e => { e.preventDefault(); end(e); }, {passive:false});

let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile && window.innerWidth === lastWidth) return; 

    lastWidth = window.innerWidth;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    pedirRender();
});

guardarEstado();
requestAnimationFrame(ejecutarRender);
