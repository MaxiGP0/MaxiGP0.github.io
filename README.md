🎨 Cuaderno Pro - Pizarra Digital Colaborativa
Cuaderno Pro es una plataforma web de pizarra digital interactiva diseñada para el estudio grupal, la diagramación y la colaboración en tiempo real.
Permite a múltiples usuarios interactuar en un mismo lienzo infinito, importar documentos, y organizar sus proyectos en la nube.

✨ Características Principales ----------------------------------------------------------------


🤝 Colaboración en Tiempo Real

Multijugador fluido: Dibuja, escribe y mueve elementos viendo los cursores y nombres de otros usuarios en vivo (vía WebSockets).

Control de Acceso: Sistema de permisos donde el creador de la sala debe aprobar la entrada de los invitados (Notificaciones UI estilo Toast).

Bifurcación de Salas (Fork): Los invitados pueden clonar y guardar una copia exacta de la pizarra del anfitrión en sus propias cuentas antes de salir.



🛠️ Herramientas de Edición Avanzadas

Lápiz y Goma: Trazos a mano alzada con grosor y color dinámico.

Formas Geométricas: Líneas, flechas, rectángulos, círculos, rombos, triángulos y estrellas.

Puntero Láser: Rastro efímero de color rojo neón para señalar elementos durante una explicación sin manchar el lienzo.

Notas Adhesivas (Sticky Notes): Cajas de texto con estilo post-it color amarillo pastel.

Sistema de Capas: Opciones para traer elementos al frente o enviarlos al fondo.

Historial de Estados: Funciones completas de Deshacer (Undo) y Rehacer (Redo).

Portapapeles: Copiar y pegar elementos rápidamente con atajos de teclado (Ctrl+C / Ctrl+V).




📄 Manejo de Medios y Documentos

Soporte Nativo para PDFs: Integración con Mozilla pdf.js para renderizar documentos multipágina directamente en el lienzo con alta resolución.

Gestión de Imágenes: Subida de imágenes locales con auto-redimensionado para optimizar el rendimiento.

Herramienta de Recorte (Crop): Dibuja un área sobre cualquier imagen o PDF para recortarlo de forma destructiva y mantener solo la información necesaria.

Exportación: Guarda el estado actual de la pizarra como una imagen .JPG de alta calidad.




🗺️ Navegación y UI/UX

Lienzo Infinito: Herramienta panorámica (Pan) y zoom (rueda del mouse o pellizco en pantallas táctiles).

Minimapa: Ventana flotante para ubicarte rápidamente en lienzos masivos.

Diseño Responsive (Mobile-First): Interfaz adaptada para celulares y tablets, con menús ocultables (hamburguesa) y barras de herramientas deslizables con efecto Glassmorphism.




🔐 Sistema de Cuentas (Dashboard)

Autenticación Segura: Registro e inicio de sesión con contraseñas encriptadas (bcrypt) y tokens de sesión (JWT).

Gestión de Perfil: Cambio de contraseña integrado.

Organización: Creación de carpetas personalizadas para agrupar y filtrar proyectos.


💻 Tecnologías Utilizadas ----------------------------------------------------------------


Frontend:

HTML5 / CSS3 (Animaciones personalizadas, Flexbox, CSS Grid).

Vanilla JavaScript (ES6+).

PDF.js (Renderizado de documentos).



Backend:

Node.js & Express.js (Servidor y API REST).

Socket.io (Comunicación bidireccional y sincronización de eventos).

MongoDB & Mongoose (Persistencia de datos y usuarios).

JWT & Bcrypt.js (Seguridad).


🚀 Instalación y Uso Local ----------------------------------------------------------------

Sigue estos pasos para correr el proyecto en tu propia computadora:


Clonar el repositorio:


git clone https://github.com/MaxiGP0/MaxiGP0.github.io

cd cuaderno-pro



Instalar las dependencias:

npm install



Configurar las variables de entorno:

Crea un archivo .env en la raíz del proyecto y añade tus credenciales:

PORT=3000

MONGO_URI=tu_cadena_de_conexion_de_mongodb

JWT_SECRET=tu_clave_secreta


Iniciar el servidor:

npm start

Abrir la aplicación:

Abrir http://localhost:3000 en tu navegador web.



📂 Estructura del Proyecto

Plaintext

cuaderno-pro/

├── public/                 # Archivos estáticos del Frontend

│   ├── index.html          # Dashboard y gestión de carpetas

│   ├── login.html          # Interfaz de Autenticación

│   ├── pizarra.html        # Lienzo principal y herramientas

│   ├── script.js           # Lógica de dibujo, WebSockets y UI

│   └── style.css           # Hoja de estilos global

├── server.js               # Servidor Express, API de usuarios y Socket.io

├── package.json            # Dependencias del proyecto

└── .env                    # Variables de entorno (No incluido en el repo)



🤝 Contribuciones ----------------------------------------------------------------

Este proyecto fue creado con el objetivo de facilitar el estudio y la diagramación rápida.

Si tienes ideas para mejorarlo, ¡las Pull Requests son bienvenidas!:

Haz un Fork del proyecto.

Crea una rama para tu nueva característica (git checkout -b feature/NuevaCaracteristica).

Haz commit de tus cambios (git commit -m 'Añadir nueva característica').

Haz Push a la rama (git push origin feature/NuevaCaracteristica).

Abre un Pull Request.
