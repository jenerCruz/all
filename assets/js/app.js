// Importaciones de librerías externas (asumiendo que están cargadas en index.html vía CDN)
// Tesseract.js para OCR, Chart.js para gráficos, lucide para iconos.

/* =============================================================
   CONSTANTES Y CONFIGURACIÓN GLOBAL
   ============================================================= */

// Configuración de la Base de Datos IndexedDB
let db;
const DB_NAME = 'AsistenciasDB';
const DB_VERSION = 1;

// Nombres de las Object Stores (Tablas)
const STORES = {
    USERS: 'users',      // Información del equipo (Promotores)
    EVIDENCES: 'evidences',  // Registros de asistencia y evidencias
    CONFIG: 'config'     // Configuración del Gist ID y Token
};

// Datos de prueba iniciales para los promotores
// En una aplicación real, estos datos se cargarían del Gist/API.
const INITIAL_USERS = [
    { id: 1, name: "Ana López", dni: "12345678A", totalAssists: 5, lastAssistance: null },
    { id: 2, name: "Roberto Gómez", dni: "87654321B", totalAssists: 3, lastAssistance: null },
    { id: 3, name: "Carla Pérez", dni: "11223344C", totalAssists: 8, lastAssistance: null },
];

// URLs para la API de GitHub Gist
const GIST_API_URL = 'https://api.github.com/gists/';
const CONFIG_KEY = 'gist_config'; // Llave para guardar la configuración de Gist en IDB

/* =============================================================
   IndexedDB (IDB) - FUNCIONES CRUD
   ============================================================= */

/**
 * Abre la conexión a IndexedDB y crea las Object Stores si no existen.
 * @returns {Promise<void>}
 */
function openDB() {
    return new Promise((resolve, reject) => {
        if (db) {
            resolve();
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (e) => {
            console.log('[IDB] Actualización necesaria. Creando stores...');
            db = e.target.result;
            if (!db.objectStoreNames.contains(STORES.USERS)) {
                db.createObjectStore(STORES.USERS, { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains(STORES.EVIDENCES)) {
                // Usamos autoIncrement para los IDs de evidencia
                db.createObjectStore(STORES.EVIDENCES, { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains(STORES.CONFIG)) {
                // La store de CONFIG usará una llave simple (e.g., 'gist_config')
                db.createObjectStore(STORES.CONFIG, { keyPath: 'key' });
            }
        };

        request.onsuccess = (e) => {
            db = e.target.result;
            console.log('[IDB] Base de datos abierta exitosamente.');
            resolve();
        };

        request.onerror = (e) => {
            console.error('[IDB] Error al abrir la base de datos:', e.target.error);
            reject(e.target.error);
        };
    });
}

/**
 * Obtiene todos los objetos de una Object Store.
 * @param {string} storeName - Nombre del store.
 * @returns {Promise<Array<Object>>}
 */
function getAll(storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();

        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Almacena un objeto en una Object Store (actualiza si existe, inserta si no).
 * @param {string} storeName - Nombre del store.
 * @param {Object} data - Objeto a guardar.
 * @returns {Promise<number>} - La clave del objeto guardado.
 */
function put(storeName, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(data);

        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Limpia la Object Store y realiza una inserción masiva de nuevos datos.
 * @param {string} storeName - Nombre del store.
 * @param {Array<Object>} dataArray - Array de objetos a insertar.
 * @returns {Promise<void>}
 */
function clearAndBulkAdd(storeName, dataArray) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);

        const clearReq = store.clear();
        clearReq.onsuccess = () => {
            let i = 0;
            // Usamos una función anidada para asegurar la secuencia de inserción
            (function addNext() {
                if (i >= dataArray.length) {
                    resolve();
                    return;
                }
                const item = dataArray[i++];
                // Elimina la propiedad 'id' si está vacía para que el autoIncrement funcione
                if (storeName === STORES.EVIDENCES && !item.id) {
                    delete item.id; 
                }
                const addReq = store.add(item);
                addReq.onsuccess = addNext;
                addReq.onerror = e => reject(e.target.error);
            })();
        };
        clearReq.onerror = e => reject(e.target.error);
    });
}

/* =============================================================
   GIST SYNCHRONIZATION - PERSISTENCIA EN LA NUBE
   ============================================================= */

// Implementación de Backoff Exponencial para peticiones fallidas
async function fetchWithBackoff(url, options, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) {
                return response;
            }
            if (response.status === 404) {
                // Si es un 404, no tiene sentido reintentar
                throw new Error("Gist not found (404). Check Gist ID.");
            }
            // Para otros errores (403, 500, etc.), esperamos y reintentamos
            console.warn(`[GIST] Fallo en fetch. Estado: ${response.status}. Reintentando en ${Math.pow(2, i)}s...`);
        } catch (error) {
            if (i === retries - 1) {
                console.error("[GIST] Todos los reintentos fallaron.", error);
                throw error;
            }
        }
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
}

/**
 * Carga la configuración de Gist (ID y Token) desde IDB.
 * @returns {Promise<{gistId: string, token: string}>}
 */
async function getGistConfig() {
    try {
        const config = await db.transaction([STORES.CONFIG], 'readonly').objectStore(STORES.CONFIG).get(CONFIG_KEY);
        // Si no hay configuración, devuelve valores por defecto (vacíos)
        if (!config) {
            return { gistId: '', token: '' };
        }
        return config.value;
    } catch (e) {
        console.error('[GIST] Error al cargar la configuración de Gist desde IDB:', e);
        // Devuelve valores vacíos para que la app continúe sin sync
        return { gistId: '', token: '' };
    }
}

/**
 * Guarda la configuración de Gist (ID y Token) en IDB.
 * @param {{gistId: string, token: string}} config - Configuración a guardar.
 * @returns {Promise<void>}
 */
async function updateGistConfig(config) {
    await put(STORES.CONFIG, { key: CONFIG_KEY, value: config });
    console.log('[GIST] Configuración guardada en IDB.');
}

/**
 * Carga los datos (USERS y EVIDENCES) desde el Gist remoto.
 * @param {string} gistId - ID del Gist.
 * @param {string} token - Token de GitHub.
 * @returns {Promise<Object>} - Datos parseados del Gist.
 */
async function loadDataFromGist(gistId, token) {
    if (!gistId || !token) {
        throw new Error("Gist ID y Token de GitHub son requeridos para la sincronización.");
    }
    const url = `${GIST_API_URL}${gistId}`;
    const options = {
        method: 'GET',
        headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': `token ${token}`
        }
    };

    console.log('[GIST] Intentando cargar datos del Gist...');

    const response = await fetchWithBackoff(url, options);
    const gist = await response.json();
    
    const file = gist.files['asistencias_pro_data.json'];
    if (!file) {
        throw new Error("El archivo 'asistencias_pro_data.json' no se encontró en el Gist.");
    }

    const content = JSON.parse(file.content);
    console.log('[GIST] Datos cargados y parseados exitosamente.');
    return content;
}

/**
 * Guarda los datos (USERS y EVIDENCES) locales en el Gist remoto.
 * @param {string} gistId - ID del Gist.
 * @param {string} token - Token de GitHub.
 * @returns {Promise<void>}
 */
async function saveDataToGist(gistId, token) {
    if (!gistId || !token) {
        console.warn("[GIST] Sincronización omitida: Gist ID o Token no configurados.");
        return;
    }
    
    // 1. Obtener datos locales
    const users = await getAll(STORES.USERS);
    const evidences = await getAll(STORES.EVIDENCES);
    
    const dataToSave = {
        users: users,
        evidences: evidences,
        lastSync: new Date().toISOString()
    };

    // 2. Preparar payload para Gist
    const payload = {
        description: "Datos de Asistencias PRO sincronizados automáticamente.",
        files: {
            'asistencias_pro_data.json': {
                content: JSON.stringify(dataToSave, null, 2)
            }
        }
    };

    const url = `${GIST_API_URL}${gistId}`;
    const options = {
        method: 'PATCH', // Usamos PATCH para actualizar
        headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': `token ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    };

    try {
        await fetchWithBackoff(url, options);
        console.log('[GIST] Datos guardados en Gist exitosamente.');
        document.getElementById('sync-status').textContent = 'Sincronizado: ' + new Date().toLocaleTimeString();
        document.getElementById('sync-status').classList.remove('text-red-500');
        document.getElementById('sync-status').classList.add('text-green-500');

    } catch (e) {
        console.error('[GIST] Error al guardar datos en Gist:', e);
        document.getElementById('sync-status').textContent = 'Error de Sincronización';
        document.getElementById('sync-status').classList.remove('text-green-500');
        document.getElementById('sync-status').classList.add('text-red-500');
    }
}

/* =============================================================
   FUNCIONES DE OCR Y VALIDACIÓN (SIMULACIÓN)
   ============================================================= */

/**
 * Convierte una fecha de formato DD/MM/YY (OCR) a YYYY-MM-DD para comparación.
 * @param {string} ocrDateString - La fecha extraída por el OCR (ej: '21/11/25').
 * @returns {string|null} - La fecha en formato estándar YYYY-MM-DD.
 */
function parseOCRDate(ocrDateString) {
    const parts = ocrDateString.split('/'); 
    if (parts.length !== 3) return null;

    // Convertimos año de 2 dígitos (YY) a 4 dígitos (YYYY). Asumimos 20XX.
    const year = parseInt(parts[2], 10);
    const currentYearShort = new Date().getFullYear() - 2000;
    
    // Si el año es mayor al actual + 10, asumimos 19XX, sino 20XX.
    const fullYear = (year > currentYearShort + 10) ? 1900 + year : 2000 + year;

    const month = parts[1].padStart(2, '0');
    const day = parts[0].padStart(2, '0');
    
    return `${fullYear}-${month}-${day}`;
}

/**
 * Realiza el procesamiento OCR en la imagen cargada.
 * Se requiere que Tesseract.js esté cargado via CDN en index.html.
 * @param {File} imageFile - Archivo de imagen del recibo.
 * @returns {Promise<{date: string, amount: number}>} - Resultados simulados.
 */
async function runOCR(imageFile) {
    document.getElementById('ocr-feedback').textContent = "Procesando OCR (Esto puede tardar)...";
    document.getElementById('ocr-feedback').classList.add('text-yellow-600');
    
    // Comprobación de Tesseract (asume que está cargado globalmente)
    if (typeof Tesseract === 'undefined') {
        document.getElementById('ocr-feedback').textContent = "ERROR: Tesseract.js no está cargado. Usando datos simulados.";
        console.error("Tesseract.js no está cargado. Asegúrate de incluirlo en tu index.html.");
        
        // SIMULACIÓN DE OCR (si Tesseract no está disponible)
        await new Promise(resolve => setTimeout(resolve, 1500)); // Simula tiempo de procesamiento
        const today = new Date();
        const day = String(today.getDate()).padStart(2, '0');
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const year = String(today.getFullYear()).slice(-2);
        
        const simulatedDate = `${day}/${month}/${year}`; // Formato DD/MM/YY
        const simulatedAmount = (Math.random() * 50 + 10).toFixed(2); // Cantidad entre 10 y 60
        
        document.getElementById('ocr-feedback').textContent = `[SIMULACIÓN] Fecha: ${simulatedDate}, Monto: ${simulatedAmount}`;
        document.getElementById('ocr-feedback').classList.remove('text-yellow-600');
        document.getElementById('ocr-feedback').classList.add('text-blue-600');

        return { date: parseOCRDate(simulatedDate), amount: parseFloat(simulatedAmount) };
    }


    // LÓGICA REAL DE TESSERACT (descomentar y adaptar si se incluye la librería)
    /*
    const { data: { text } } = await Tesseract.recognize(
        imageFile,
        'eng',
        { logger: m => console.log('[OCR]', m.status, m.progress) }
    );
    
    // Aquí iría la lógica compleja para extraer fecha (DD/MM/YY) y monto (XX.XX) del texto
    // Por simplicidad, esta función devolvería los resultados extraídos:
    const extractedDate = '15/10/25'; // Simulación de extracción
    const extractedAmount = 45.75;    // Simulación de extracción

    document.getElementById('ocr-feedback').textContent = "OCR completado. Extracción exitosa.";
    document.getElementById('ocr-feedback').classList.remove('text-yellow-600');
    document.getElementById('ocr-feedback').classList.add('text-green-600');
    
    return { date: parseOCRDate(extractedDate), amount: extractedAmount };
    */
}

/* =============================================================
   MANEJO DE UI Y EVENTOS
   ============================================================= */

let currentUserId = null; // Almacena el ID del promotor seleccionado

/**
 * Muestra un modal con el ID especificado.
 * @param {string} modalId - El ID del modal (e.g., 'modal-ocr', 'modal-config').
 */
function openModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
}

/**
 * Oculta un modal con el ID especificado.
 * @param {string} modalId - El ID del modal.
 */
function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
    // Limpia el formulario de asistencia si se cierra el modal de OCR
    if (modalId === 'modal-ocr') {
        document.getElementById('attendance-form').reset();
        document.getElementById('ocr-preview').innerHTML = ''; // Limpia preview de imagen
        document.getElementById('ocr-feedback').textContent = ''; // Limpia feedback
    }
}

/**
 * Renderiza la cuadrícula de promotores.
 * @param {Array<Object>} users - Lista de objetos de promotores.
 */
function renderTeamGrid(users) {
    const grid = document.getElementById('team-grid');
    if (!grid) return;
    grid.innerHTML = '';

    users.sort((a, b) => b.totalAssists - a.totalAssists); // Ordena por más asistencias

    users.forEach(user => {
        const lastDate = user.lastAssistance ? new Date(user.lastAssistance).toLocaleDateString() : 'Nunca';
        const cardHtml = `
            <div id="user-card-${user.id}" data-id="${user.id}"
                 class="bg-white p-4 rounded-xl shadow-lg hover:shadow-xl transition duration-300 transform hover:scale-[1.02] 
                        border-b-4 border-indigo-400 cursor-pointer flex flex-col justify-between"
                 onclick="handleUserSelect(${user.id}, '${user.name}')">
                <div class="flex items-center space-x-3">
                    <span class="p-3 bg-indigo-100 text-indigo-600 rounded-full" data-lucide="user"></span>
                    <div>
                        <h2 class="text-lg font-bold text-gray-800">${user.name}</h2>
                        <p class="text-sm text-gray-500">DNI: ${user.dni}</p>
                    </div>
                </div>
                <div class="mt-4 border-t pt-3 flex justify-between text-sm text-gray-600">
                    <div class="flex items-center space-x-1">
                        <span data-lucide="check-circle" class="w-4 h-4 text-green-500"></span>
                        <span class="font-semibold">Asistencias: ${user.totalAssists}</span>
                    </div>
                    <div class="flex items-center space-x-1">
                        <span data-lucide="calendar" class="w-4 h-4 text-orange-500"></span>
                        <span>Última: ${lastDate}</span>
                    </div>
                </div>
            </div>
        `;
        grid.insertAdjacentHTML('beforeend', cardHtml);
    });

    // Re-crear los iconos de Lucide después de renderizar el HTML
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

/**
 * Maneja la selección de un promotor para abrir el modal de asistencia.
 * @param {number} userId - ID del promotor.
 * @param {string} userName - Nombre del promotor.
 */
function handleUserSelect(userId, userName) {
    currentUserId = userId;
    document.getElementById('modal-title').textContent = `Registrar Asistencia para: ${userName}`;
    document.getElementById('ocr-feedback').textContent = '';
    document.getElementById('ocr-preview').innerHTML = '';
    document.getElementById('attendance-form').reset();
    openModal('modal-ocr');
}

/**
 * Maneja el evento de carga de la imagen para previsualización y OCR.
 * @param {Event} e - Evento de cambio del input file.
 */
async function handleImageUpload(e) {
    const file = e.target.files[0];
    const previewContainer = document.getElementById('ocr-preview');
    const form = document.getElementById('attendance-form');

    if (file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            // Mostrar previsualización
            previewContainer.innerHTML = `<img src="${e.target.result}" alt="Recibo de Evidencia" class="max-h-64 w-full object-contain rounded-lg shadow-inner mb-4">`;

            // Ejecutar OCR y llenar formulario
            try {
                const ocrResult = await runOCR(file);
                
                // Llenar el formulario con los datos extraídos/simulados
                form.elements['attendanceDate'].value = ocrResult.date || new Date().toISOString().substring(0, 10); // Usa hoy si falla el parseo
                form.elements['attendanceAmount'].value = ocrResult.amount ? ocrResult.amount.toFixed(2) : '0.00';
                
                document.getElementById('btn-submit-attendance').disabled = false;
                document.getElementById('btn-submit-attendance').classList.remove('opacity-50', 'cursor-not-allowed');

            } catch (error) {
                console.error("Fallo completo en OCR:", error);
                document.getElementById('ocr-feedback').textContent = "Fallo completo en el proceso OCR/Simulación.";
                document.getElementById('ocr-feedback').classList.remove('text-blue-600', 'text-green-600');
                document.getElementById('ocr-feedback').classList.add('text-red-500');
                document.getElementById('btn-submit-attendance').disabled = true;
            }
        };
        reader.readAsDataURL(file);
    }
}

/**
 * Maneja el envío del formulario de asistencia.
 * @param {Event} e - Evento de submit.
 */
async function handleAttendanceSubmit(e) {
    e.preventDefault();

    if (!currentUserId) {
        console.error("No hay un usuario seleccionado.");
        return;
    }

    const form = e.target;
    const dateValue = form.elements['attendanceDate'].value;
    const amountValue = parseFloat(form.elements['attendanceAmount'].value);
    const notesValue = form.elements['attendanceNotes'].value;
    const imageInput = form.elements['imageUpload'];
    
    // Convertir la imagen a Base64 para guardarla en IDB (solo para demostración, ¡no recomendado para imágenes grandes!)
    let imageBase64 = null;
    if (imageInput.files.length > 0) {
        imageBase64 = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(imageInput.files[0]);
        });
    }

    // 1. Crear el nuevo registro de evidencia
    const newEvidence = {
        userId: currentUserId,
        date: dateValue,
        amount: amountValue,
        notes: notesValue,
        image: imageBase64, // Base64 de la imagen
        timestamp: new Date().toISOString()
    };

    try {
        // 2. Guardar la evidencia en IDB
        await put(STORES.EVIDENCES, newEvidence);
        console.log(`Evidencia guardada para el usuario ${currentUserId}.`);

        // 3. Actualizar datos del usuario (total de asistencias y última fecha)
        const allUsers = await getAll(STORES.USERS);
        const userToUpdate = allUsers.find(u => u.id === currentUserId);
        
        if (userToUpdate) {
            userToUpdate.totalAssists = (userToUpdate.totalAssists || 0) + 1;
            userToUpdate.lastAssistance = dateValue;
            await put(STORES.USERS, userToUpdate);
        }

        // 4. Sincronizar con Gist en segundo plano
        const config = await getGistConfig();
        saveDataToGist(config.gistId, config.token);

        // 5. Actualizar UI y cerrar modal
        renderTeamGrid(allUsers);
        closeModal('modal-ocr');

        // Mostrar notificación de éxito (usamos la propia UI, no alert)
        showNotification('Asistencia registrada y sincronización iniciada.', 'success');

    } catch (e) {
        console.error('Error al registrar la asistencia:', e);
        showNotification('Error al guardar la asistencia en el almacenamiento local.', 'error');
    }
}

/**
 * Muestra una notificación temporal en la UI.
 * @param {string} message - Mensaje a mostrar.
 * @param {('success'|'error')} type - Tipo de mensaje para el color.
 */
function showNotification(message, type) {
    const notif = document.getElementById('app-notification');
    notif.textContent = message;
    notif.classList.remove('hidden', 'bg-green-500', 'bg-red-500');
    notif.classList.add('block', type === 'success' ? 'bg-green-500' : 'bg-red-500');

    setTimeout(() => {
        notif.classList.add('hidden');
    }, 3000);
}

/**
 * Maneja el guardado de la configuración del Gist desde el modal.
 */
async function handleConfigSubmit(e) {
    e.preventDefault();
    const gistId = document.getElementById('gistId').value.trim();
    const token = document.getElementById('githubToken').value.trim();

    if (gistId && token) {
        await updateGistConfig({ gistId, token });
        closeModal('modal-config');
        showNotification('Configuración de Gist guardada. Intentando cargar datos...', 'success');
        
        // Intentar cargar datos remotos después de guardar la configuración
        await initialDataLoad(gistId, token);
    } else {
        showNotification('Debe ingresar ID del Gist y Token.', 'error');
    }
}

/**
 * Maneja la carga inicial de datos desde el Gist o usa valores por defecto.
 * @param {string} gistId - ID del Gist.
 * @param {string} token - Token de GitHub.
 */
async function initialDataLoad(gistId, token) {
    try {
        if (gistId && token) {
            const remoteData = await loadDataFromGist(gistId, token);
            
            // 1. Cargar USERS y EVIDENCES del Gist a IDB
            await clearAndBulkAdd(STORES.USERS, remoteData.users);
            await clearAndBulkAdd(STORES.EVIDENCES, remoteData.evidences);
            console.log('[IDB] Datos locales actualizados desde Gist.');
            showNotification('Datos de asistencia cargados y sincronizados desde Gist.', 'success');
            document.getElementById('sync-status').textContent = 'Sincronizado: ' + new Date().toLocaleTimeString();

            // 2. Renderizar con datos del Gist
            renderTeamGrid(remoteData.users);

        } else {
            // Si no hay Gist ID, usa datos iniciales solo si la store está vacía
            const currentUsers = await getAll(STORES.USERS);
            if (currentUsers.length === 0) {
                console.log('[IDB] Usando datos iniciales por defecto.');
                await clearAndBulkAdd(STORES.USERS, INITIAL_USERS);
                renderTeamGrid(INITIAL_USERS);
            } else {
                 console.log('[IDB] Usando datos existentes en local (sin Gist).');
                 renderTeamGrid(currentUsers);
            }
            showNotification('Modo Offline/Local: Gist no configurado.', 'error');
            document.getElementById('sync-status').textContent = 'Modo Local (Sin Gist)';
        }
    } catch (e) {
        console.error("Error al cargar datos remotos/locales:", e);
        showNotification(`Error al cargar datos: ${e.message}. Usando local.`, 'error');
        document.getElementById('sync-status').textContent = 'Error de Carga Remota';
        
        // Cargar lo que haya en IDB aunque haya fallado la carga del Gist
        const currentUsers = await getAll(STORES.USERS);
        renderTeamGrid(currentUsers);
    }
}

/* =============================================================
   INICIALIZACIÓN DE LA APLICACIÓN
   ============================================================= */

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 1. Abrir la DB (debe ser lo primero)
        await openDB();
        
        // 2. Cargar configuración de Gist
        const config = await getGistConfig();

        // 3. Cargar datos (remotos o locales por defecto)
        await initialDataLoad(config.gistId, config.token);

        // 4. Configurar listeners de eventos
        document.getElementById('imageUpload').addEventListener('change', handleImageUpload);
        document.getElementById('attendance-form').addEventListener('submit', handleAttendanceSubmit);
        document.getElementById('gist-config-form').addEventListener('submit', handleConfigSubmit);

        // 5. Configurar botones de cerrar modal (asume que los botones tienen la clase 'close-modal')
        document.querySelectorAll('.close-modal').forEach(button => {
            button.addEventListener('click', (e) => {
                const modalId = e.target.closest('.modal-overlay').id;
                closeModal(modalId);
            });
        });
        
        // 6. Configurar botón de abrir configuración
        document.getElementById('btn-open-config').addEventListener('click', () => {
             // Llenar el formulario de config con valores actuales
            document.getElementById('gistId').value = config.gistId;
            document.getElementById('githubToken').value = config.token;
            openModal('modal-config');
        });

        // Asegurarse de que los iconos iniciales se muestren
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

    } catch (e) {
        console.error("Error al inicializar la aplicación:", e);
        showNotification('Fallo crítico al inicializar la DB. La aplicación no puede continuar.', 'error');
    }
});

/* ===========================
   SERVICE WORKER (SW) registro - Esto debe ir en el index.html
   =========================== */
// Nota: Esta parte idealmente va en el index.html para un registro temprano, 
// pero se incluye aquí para completar el archivo si se usa como módulo.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('[SW] Service Worker registrado.'))
    .catch(e => console.warn('[SW] Error al registrar el Service Worker:', e));
}