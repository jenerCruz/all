/**
 * evidence-module.js
 * Módulo autónomo para:
 * - manejar entrada/salida de evidencia (foto)
 * - previsualización
 * - IndexedDB (AsistenciasPRODB v2) + localStorage índice
 * - sincronización opcional con Gist
 * - OCR si Tesseract está disponible
 *
 * Diseñado para funcionar SOBRE tu index actual sin modificar el diseño.
 */

(function(window, document){
  'use strict';

  // --- Config (ajustable) ---
  const DB_NAME = 'AsistenciasPRODB';
  const DB_VERSION = 2;
  const STORES = {
    USERS: 'users',
    EVIDENCES: 'evidences',
    CONFIG: 'config',
    SCHEDULES: 'schedules',
    DOCUMENTS: 'documents'
  };
  const GIST_FILE_NAME = 'gestion_asistencias_pro_full.json';
  const LOCAL_LIST_KEY = 'evidencias_index'; // localStorage index (ligero)

  const IDS = {
    btnEntrada: 'fotoEntradaBtn',
    btnSalida: 'fotoSalidaBtn',
    inputFile: 'evidenciaInput',
    previewEntrada: 'preview-entrada',
    previewSalida: 'preview-salida',
    evidenceDate: 'evidence-date' // ya existe en tu index
  };

  // --- Estado interno ---
  let tipoActual = null; // 'entrada' | 'salida'
  let db = null;
  let activeUserId = window.activeUserId || null; // si tu index mantiene activeUserId lo recogeremos
  let pendingImageFile = null;

  // --- Utilidades ---
  function log(...args){ console.log('[EVIDENCE]', ...args); }
  function warn(...args){ console.warn('[EVIDENCE]', ...args); }
  function err(...args){ console.error('[EVIDENCE]', ...args); }

  function showToast(msg, isError){
    // Reusa la función showToast si ya existe; si no, usa alert (no quiero cambiar tu UI)
    if (typeof window.showToast === 'function') return window.showToast(msg, !!isError);
    if (isError) alert('Error: ' + msg); else console.log(msg);
  }

  // --- IndexedDB básico (compatible con tu index) ---
  function openDB(){
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const idb = e.target.result;
        if (!idb.objectStoreNames.contains(STORES.USERS)) idb.createObjectStore(STORES.USERS, { keyPath: 'id' });
        if (!idb.objectStoreNames.contains(STORES.EVIDENCES)) idb.createObjectStore(STORES.EVIDENCES, { keyPath: 'id' });
        if (!idb.objectStoreNames.contains(STORES.CONFIG)) idb.createObjectStore(STORES.CONFIG, { keyPath: 'key' });
        if (!idb.objectStoreNames.contains(STORES.SCHEDULES)) idb.createObjectStore(STORES.SCHEDULES, { keyPath: 'id' });
        if (!idb.objectStoreNames.contains(STORES.DOCUMENTS)) idb.createObjectStore(STORES.DOCUMENTS, { keyPath: 'id' });
      };
      req.onsuccess = (e) => { db = e.target.result; log('IDB abierto'); resolve(db); };
      req.onerror = (e) => { err('Error abrir IDB', e); reject(e); };
    });
  }

  function idbTransaction(storeName, mode='readonly'){
    const tx = db.transaction([storeName], mode);
    return tx.objectStore(storeName);
  }

  function idbGet(storeName, key){
    return new Promise((resolve, reject) => {
      try {
        const store = idbTransaction(storeName, 'readonly');
        const r = store.get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = e => reject(e);
      } catch(e){ reject(e); }
    });
  }

  function idbPut(storeName, value){
    return new Promise((resolve, reject) => {
      try {
        const store = idbTransaction(storeName, 'readwrite');
        const r = store.put(value);
        r.onsuccess = () => resolve(r.result);
        r.onerror = e => reject(e);
      } catch(e){ reject(e); }
    });
  }

  function idbGetAll(storeName){
    return new Promise((resolve, reject) => {
      try {
        const store = idbTransaction(storeName, 'readonly');
        const r = store.getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = e => reject(e);
      } catch(e){ reject(e); }
    });
  }

  // --- Helpers imagenes ---
  function fileToDataURL(file, maxWidth = 1000, quality = 0.7){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          // Resize if needed
          let canvas = document.createElement('canvas');
          let w = img.width, h = img.height;
          if (w > maxWidth) {
            h = Math.round(h * (maxWidth / w));
            w = maxWidth;
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        };
        img.onerror = (e) => reject(e);
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // --- Guardado de evidencia ---
  async function saveEvidenceForUser(userId, dateISO, tipo, dataUrl, ocrResult = null){
    // id compuesto: userId_fecha (YYYY-MM-DD)
    const id = `${userId}_${dateISO}`;
    try {
      const existing = await idbGet(STORES.EVIDENCES, id);
      const record = existing || {
        id,
        userId,
        fecha: dateISO,
        entrada: null,
        salida: null,
        validatedEntry: null,
        validatedExit: null,
        timestamp: Date.now()
      };

      if (tipo === 'entrada') {
        record.entrada = dataUrl;
        record.validatedEntry = ocrResult || true;
      } else {
        record.salida = dataUrl;
        record.validatedExit = ocrResult || true;
      }

      await idbPut(STORES.EVIDENCES, record);

      // Index local (ligero) para rápido acceso
      const indexList = JSON.parse(localStorage.getItem(LOCAL_LIST_KEY) || '[]');
      indexList.push({ id, userId, fecha: dateISO, tipo, createdAt: Date.now() });
      localStorage.setItem(LOCAL_LIST_KEY, JSON.stringify(indexList));

      showToast('Evidencia guardada localmente.');
      // Actualizar preview en UI (si los elementos existen)
      updatePreviewUI(tipo, dataUrl);

      return record;
    } catch (e) {
      err('saveEvidenceForUser', e);
      throw e;
    }
  }

  function updatePreviewUI(tipo, dataUrl){
    try {
      const elId = tipo === 'entrada' ? IDS.previewEntrada : IDS.previewSalida;
      const previewEl = document.getElementById(elId);
      if (!previewEl) return;
      previewEl.innerHTML = `<img src="${dataUrl}" class="w-full h-full object-cover">`;
    } catch(e){ /* no crítico */ }
  }

  // --- OCR (si está disponible) ---
  async function doOCRFromDataUrl(dataUrl){
    if (typeof Tesseract === 'undefined') {
      log('Tesseract no disponible — saltando OCR');
      return null;
    }
    try {
      showToast('Iniciando OCR de la imagen...');
      // Tesseract acepta blobs, pero reconocerá el dataURL si se pasa como objeto
      const worker = Tesseract.createWorker({ logger: m => {} });
      await worker.load();
      await worker.loadLanguage('spa');
      await worker.initialize('spa');

      // Convertir dataUrl a blob para Tesseract
      const res = await fetch(dataUrl);
      const blob = await res.blob();

      const { data: { text } } = await worker.recognize(blob);
      await worker.terminate();
      log('OCR result:', text);
      return text.trim();
    } catch (e) {
      warn('OCR fallo', e);
      return null;
    }
  }

  // --- Gist Sync helpers ---
  async function getGistConfig(){
    try {
      const cfg = await idbGet(STORES.CONFIG, 'gist');
      if (!cfg) return { id: '', token: '' };
      return cfg.value || { id: '', token: '' };
    } catch(e){
      warn('No se pudo leer configuración Gist', e);
      return { id: '', token: '' };
    }
  }

  async function setGistConfig(gistId, token){
    await idbPut(STORES.CONFIG, { key: 'gist', value: { id: gistId, token }});
  }

  async function syncToGist(){
    const cfg = await getGistConfig();
    if (!cfg.id || !cfg.token) {
      showToast('Gist no configurado — omitiendo sincronización.', true);
      return;
    }
    try {
      showToast('Sincronizando datos con Gist...');
      const users = await idbGetAll(STORES.USERS);
      const evidences = await idbGetAll(STORES.EVIDENCES);

      const payload = {
        description: `Backup Asistencias PRO - ${new Date().toISOString()}`,
        files: {
          [GIST_FILE_NAME]: { content: JSON.stringify({ users, evidences }, null, 2) }
        }
      };

      const res = await fetch(`https://api.github.com/gists/${cfg.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `token ${cfg.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('Sincronización con Gist finalizada.');
      return true;
    } catch(e){
      err('syncToGist fallo', e);
      showToast('Error sincronizando con Gist.', true);
      return false;
    }
  }

  // --- Eventos UI: conectar botones e input ---
  function attachUI(){
    const btnE = document.getElementById(IDS.btnEntrada);
    const btnS = document.getElementById(IDS.btnSalida);
    let input = document.getElementById(IDS.inputFile);

    if (!btnE || !btnS) {
      warn('Botones de entrada/salida no encontrados - asegúrate de tener los IDs correctos:', IDS);
      return;
    }

    if (!input) {
      // Si no existe, creamos un input invisible y lo colocamos en DOM para no modificar UI
      input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.id = IDS.inputFile;
      input.style.display = 'none';
      document.body.appendChild(input);
      log('Input file agregado dinámicamente (oculto).');
    }

    input.addEventListener('change', async function(e){
      const file = this.files[0];
      if (!file) { showToast('No se seleccionó imagen.', true); return; }

      // Validaciones: fecha y usuario
      const dateEl = document.getElementById(IDS.evidenceDate);
      const selectedDate = dateEl ? dateEl.value : (new Date().toISOString().split('T')[0]);
      if (!selectedDate) {
        showToast('Selecciona una fecha antes de subir la evidencia.', true);
        return;
      }

      if (!activeUserId && window.activeUserId) activeUserId = window.activeUserId;
      if (!activeUserId) {
        showToast('Selecciona un promotor antes de subir la evidencia.', true);
        return;
      }

      try {
        const dataUrl = await fileToDataURL(file, 1200, 0.7);

        // Update preview immediately
        updatePreviewUI(tipoActual || 'entrada', dataUrl);

        // attempt OCR (non-blocking if fails)
        const ocrText = await doOCRFromDataUrl(dataUrl);

        // Save into IDB
        await saveEvidenceForUser(activeUserId, selectedDate, tipoActual || 'entrada', dataUrl, ocrText ? { raw: ocrText } : null);

        // Try to sync to gist in background (non-blocking)
        setTimeout(() => {
          syncToGist().catch(e => warn('syncToGist background failed', e));
        }, 300);

      } catch (e) {
        err('Error procesando imagen', e);
        showToast('Error procesando la imagen.', true);
      } finally {
        // clear value so same file can be reselected if needed
        this.value = '';
      }
    });

    btnE.addEventListener('click', () => { tipoActual = 'entrada'; input.click(); });
    btnS.addEventListener('click', () => { tipoActual = 'salida'; input.click(); });

    log('UI handlers attached');
  }

  // --- Public API si alguien quiere usarlo desde consola ---
  const API = {
    init: async function(userId){
      if (userId) activeUserId = userId;
      await openDB();
      attachUI();
      log('Evidence Module initialized');
    },
    setActiveUser: function(userId){
      activeUserId = userId;
    },
    syncNow: syncToGist,
    getLocalIndex: function(){ return JSON.parse(localStorage.getItem(LOCAL_LIST_KEY) || '[]'); },
    openDB // expose for debugging
  };

  // Auto-init on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await openDB();
      // if global activeUserId exists in your index it will be used
      if (window.activeUserId) activeUserId = window.activeUserId;
      attachUI();
    } catch(e){ warn('init failed', e); }
  });

  // Exponer API globalmente sin poluir (namespace)
  window.EvidenceModule = API;

})(window, document);