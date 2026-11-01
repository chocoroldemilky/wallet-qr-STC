/*
OBJETIVO:
Gestionar la persistencia local de los boletos y sus datos cifrados.

RESPONSABILIDADES PREVISTAS:
- Guardar y recuperar boletos cifrados.
- Coordinar el uso de AES-GCM para proteger la informacion.
- Gestionar errores de lectura, escritura y descifrado.
- Evitar la persistencia innecesaria de informacion sensible.

DEPENDENCIAS:
cripto.js (AES-GCM) y Dexie (copia local en src/js/vendor).

Responsable: Francisco Omar Gutierrez Silva (Modulo 5)
*/

// Dexie: copia local en src/js/vendor (no requiere internet ni empaquetador).
import Dexie from "./vendor/dexie.mjs";
import { generateAESKey, encryptTicket, decryptTicket, CryptoError, ERR as CRYPTO_ERR } from "./cripto.js";

// ---------- Esquema de la base local ----------
export const DB_NAME = "walletDB";

// Estados posibles de un boleto (documento del proyecto, seccion 5).
export const TICKET_STATUS = Object.freeze({
  ACTIVO: "ACTIVO",
  USADO: "USADO",
  CANCELADO: "CANCELADO",
  PENDIENTE_SINCRO: "PENDIENTE_SINCRO",
});

/*
Tabla "tickets": un registro por boleto.
  ticketId        (clave primaria, SIN cifrar)  identificador del boleto
  status          (indice, SIN cifrar)          uno de TICKET_STATUS
  iv              (cifrado)                     IV de AES-GCM en base64url
  ciphertext      (cifrado)                     boleto completo cifrado (incluye skSession y firma)
  updatedAt       (indice)                      ms desde epoch de la ultima escritura local
  last_synced_at                                ms desde epoch de la ultima sincronizacion con el servidor (o null)

Tabla "keys": material criptografico local.
  id   (clave primaria)  nombre de la clave, p. ej. "storage-aes"
  key                    CryptoKey AES-GCM NO extraible (IndexedDB la guarda sin exponer sus bytes)

En Dexie solo se declaran la clave primaria y los indices; el resto de campos se guarda igual.
Solo ticketId y status quedan en claro (decision D3 de la bitacora). Si se agregan campos en claro
(p. ej. nombre del evento y fecha), crear db.version(2) en lugar de modificar la version 1.
*/
export function createDB(name = DB_NAME) {
  const db = new Dexie(name);
  db.version(1).stores({
    tickets: "ticketId, status, updatedAt",
    keys: "id",
  });
  return db;
}


// Instancia unica que usa la aplicacion. Dexie abre la base en la primera operacion.
export const db = createDB();

// ---------- Errores ----------
/*
Todas las funciones publicas de este modulo fallan con StorageError, que tiene un "code" para que la
interfaz decida que mensaje mostrar. El mensaje nunca incluye datos del boleto ni claves.
"cause" conserva el error original (Dexie, Web Crypto) solo para depuracion.
*/
export const STORAGE_ERR = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",       // boleto, ticketId o status con formato incorrecto
  DB_UNAVAILABLE: "DB_UNAVAILABLE",     // IndexedDB no existe, esta bloqueada o no se pudo abrir
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",     // el navegador no tiene espacio para guardar
  DECRYPT_FAILED: "DECRYPT_FAILED",     // clave incorrecta o datos cifrados alterados
  CORRUPTED: "CORRUPTED",               // registro o clave guardada con estructura invalida
  OPERATION_FAILED: "OPERATION_FAILED", // cualquier otro fallo
});

export class StorageError extends Error {
  constructor(code, message, { cause, ticketId } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "StorageError";
    this.code = code;
    if (ticketId !== undefined) this.ticketId = ticketId; // el ticketId no es secreto (va en claro)
  }
}

// Nombres de error de Dexie / IndexedDB que significan "la base no se puede usar".
const DB_UNAVAILABLE_NAMES = new Set([
  "MissingAPIError", "OpenFailedError", "DatabaseClosedError", "InvalidStateError",
  "VersionError", "UpgradeError", "SecurityError", "InvalidAccessError",
]);

// Convierte cualquier error en StorageError.
function toStorageError(err, ticketId) {
  if (err instanceof StorageError) return err;
  const opts = { cause: err, ticketId };

  if (err instanceof CryptoError) {
    switch (err.code) {
      case CRYPTO_ERR.DECRYPT_FAILED:
        return new StorageError(STORAGE_ERR.DECRYPT_FAILED,
          "No se pudo descifrar el boleto: clave incorrecta o datos alterados", opts);
      case CRYPTO_ERR.BAD_FORMAT:
        return new StorageError(STORAGE_ERR.CORRUPTED, "El contenido descifrado no es un boleto valido", opts);
      case CRYPTO_ERR.INVALID_KEY:
        return new StorageError(STORAGE_ERR.CORRUPTED, "La clave local guardada no es valida", opts);
      default:
        return new StorageError(STORAGE_ERR.OPERATION_FAILED, "Fallo una operacion criptografica", opts);
    }
  }

  // Dexie envuelve el error nativo en "inner"; se revisan ambos nombres.
  const names = [err?.name, err?.inner?.name];
  if (names.includes("QuotaExceededError")) {
    return new StorageError(STORAGE_ERR.QUOTA_EXCEEDED, "No hay espacio suficiente para guardar los boletos", opts);
  }
  if (names.some((n) => DB_UNAVAILABLE_NAMES.has(n))) {
    return new StorageError(STORAGE_ERR.DB_UNAVAILABLE, "El almacenamiento local no esta disponible", opts);
  }
  return new StorageError(STORAGE_ERR.OPERATION_FAILED, "Fallo una operacion de almacenamiento", opts);
}

// Ejecuta fn y convierte cualquier fallo en StorageError.
async function guard(fn, ticketId) {
  try {
    return await fn();
  } catch (err) {
    throw toStorageError(err, ticketId);
  }
}

/**
 * Abre la base y comprueba que IndexedDB funciona. Util al iniciar la app para avisar al usuario.
 * @throws {StorageError} DB_UNAVAILABLE si el navegador no permite usar IndexedDB
 */
export function openStorage(database = db) {
  return guard(async () => {
    await database.open();
    return true;
  });
}

// ---------- Clave AES local ----------
/*
La clave que cifra los boletos se genera una sola vez por navegador y se guarda en la tabla "keys"
como CryptoKey NO extraible: el JavaScript de la pagina puede usarla para cifrar/descifrar, pero no
puede leer ni exportar sus bytes.

Limitaciones (documentar al equipo):
- Protege contra lectura casual de IndexedDB, no contra codigo malicioso que corra en la misma pagina
  (ese codigo podria usar la clave aunque no pueda extraerla).
- Si el usuario borra los datos del sitio se pierden la clave y los boletos; habra que volver a
  descargarlos del servidor.
*/
export const STORAGE_KEY_ID = "storage-aes";

// Una promesa por base: evita generar dos claves si se llama varias veces al mismo tiempo.
const keyCache = new WeakMap();

export function getOrCreateStorageKey(database = db) {
  if (!keyCache.has(database)) {
    const pending = guard(() => loadOrCreateKey(database)).catch((err) => {
      keyCache.delete(database); // permitir reintentar despues de un error
      throw err;
    });
    keyCache.set(database, pending);
  }
  return keyCache.get(database);
}

function assertStoredKey(entry) {
  const key = entry?.key;
  const valid = key instanceof CryptoKey && key.algorithm?.name === "AES-GCM" &&
    key.usages.includes("encrypt") && key.usages.includes("decrypt");
  if (!valid) throw new StorageError(STORAGE_ERR.CORRUPTED, "La clave local guardada no es valida");
  return key;
}

async function loadOrCreateKey(database) {
  const existing = await database.keys.get(STORAGE_KEY_ID);
  if (existing) return assertStoredKey(existing);

  // La clave se genera fuera de la transaccion: Dexie cierra la transaccion si se espera
  // una operacion que no es de IndexedDB (como crypto.subtle).
  const key = await generateAESKey(false);
  try {
    await database.keys.add({ id: STORAGE_KEY_ID, key, createdAt: Date.now() });
    return key;
  } catch (err) {
    // Otra pestana la creo primero: usar la suya para que todas cifren con la misma clave.
    if (err?.name === "ConstraintError") {
      return assertStoredKey(await database.keys.get(STORAGE_KEY_ID));
    }
    throw err;
  }
}

// ---------- Operaciones con boletos ----------
/*
Formato de entrada: el boleto se guarda tal como llega del Modulo 4 (objeto JSON). Solo se exige
"ticketId" (texto no vacio). Si no trae "status" se usa ACTIVO. Todo el objeto (evento, asiento,
skSession, firma, etc.) se cifra con AES-GCM; en claro solo quedan ticketId y status.

El status en claro es el que manda al leer (puede cambiar con updateTicketStatus sin volver a cifrar).
Nota: el status local es informativo; la autorizacion final de acceso la decide el validador/servidor.
*/

function invalid(message) {
  return new StorageError(STORAGE_ERR.INVALID_INPUT, message);
}

function assertTicketId(ticketId) {
  if (typeof ticketId !== "string" || ticketId.trim() === "") {
    throw invalid("ticketId debe ser un texto no vacio");
  }
}

function assertStatus(status) {
  if (!Object.values(TICKET_STATUS).includes(status)) {
    throw invalid(`status invalido; valores permitidos: ${Object.values(TICKET_STATUS).join(", ")}`);
  }
}

// Valida el boleto antes de cifrarlo. Regresa el status que se guardara.
function validateTicket(ticket) {
  if (!ticket || typeof ticket !== "object" || Array.isArray(ticket)) {
    throw invalid("El boleto debe ser un objeto");
  }
  assertTicketId(ticket.ticketId);
  const status = ticket.status ?? TICKET_STATUS.ACTIVO;
  assertStatus(status);
  return status;
}

// Construye el registro cifrado que se guarda en la tabla tickets.
async function buildRecord(ticket, key, syncedAt) {
  const status = validateTicket(ticket);
  const { iv, ciphertext } = await encryptTicket(ticket, key);
  return {
    ticketId: ticket.ticketId,
    status,
    iv,
    ciphertext,
    updatedAt: Date.now(),
    last_synced_at: syncedAt,
  };
}

// Descifra un registro y comprueba que el contenido corresponde a ese ticketId
// (evita que se intercambie el contenido cifrado entre dos boletos).
async function openRecord(record, key) {
  const corrupted = (msg) => new StorageError(STORAGE_ERR.CORRUPTED, msg, { ticketId: record.ticketId });
  if (typeof record.iv !== "string" || typeof record.ciphertext !== "string") {
    throw corrupted("El registro del boleto esta incompleto");
  }
  const ticket = await guard(() => decryptTicket(record, key), record.ticketId);
  if (!ticket || typeof ticket !== "object" || ticket.ticketId !== record.ticketId) {
    throw corrupted("El contenido cifrado no corresponde al boleto");
  }
  return { ...ticket, status: record.status };
}

/**
 * Guarda (o reemplaza) un boleto cifrado.
 * @param {object} ticket  boleto con al menos ticketId
 * @param {{ syncedAt?: number|null, database?: Dexie }} [options]
 *        syncedAt: momento de la sincronizacion con el servidor (ms); null si es solo local
 * @returns {Promise<{ticketId: string, status: string}>}
 * @throws {StorageError} INVALID_INPUT, QUOTA_EXCEEDED, DB_UNAVAILABLE, CORRUPTED, OPERATION_FAILED
 */
export function saveTicket(ticket, { syncedAt = null, database = db } = {}) {
  return guard(async () => {
    validateTicket(ticket); // falla rapido, antes de tocar la base
    const key = await getOrCreateStorageKey(database);
    const record = await buildRecord(ticket, key, syncedAt);
    await database.tickets.put(record);
    return { ticketId: record.ticketId, status: record.status };
  }, ticket?.ticketId);
}

/**
 * Guarda varios boletos (p. ej. la respuesta del Modulo 4) en una sola transaccion:
 * o se guardan todos o ninguno. Se cifran antes de abrir la transaccion.
 * @returns {Promise<number>} cantidad de boletos guardados
 * @throws {StorageError} igual que saveTicket; con INVALID_INPUT no se guarda ninguno
 */
export function saveTickets(tickets, { syncedAt = null, database = db } = {}) {
  return guard(async () => {
    if (!Array.isArray(tickets)) throw invalid("Se esperaba un arreglo de boletos");
    tickets.forEach(validateTicket);
    const key = await getOrCreateStorageKey(database);
    const records = await Promise.all(tickets.map((t) => buildRecord(t, key, syncedAt)));
    await database.tickets.bulkPut(records);
    return records.length;
  });
}

/**
 * Recupera y descifra un boleto.
 * @returns {Promise<object|null>} el boleto completo, o null si no existe
 * @throws {StorageError} INVALID_INPUT, DECRYPT_FAILED, CORRUPTED, DB_UNAVAILABLE, OPERATION_FAILED
 */
export function getTicket(ticketId, { database = db } = {}) {
  return guard(async () => {
    assertTicketId(ticketId);
    const record = await database.tickets.get(ticketId);
    if (!record) return null;
    const key = await getOrCreateStorageKey(database);
    return openRecord(record, key);
  }, ticketId);
}

/**
 * Lista los boletos guardados.
 * Por defecto NO descifra: regresa solo los datos en claro (rapido, para la vista de lista).
 * Con decrypt: true regresa los boletos completos. Un boleto danado no impide ver los demas:
 * en su lugar se regresa { ticketId, status, error: <codigo de STORAGE_ERR> }.
 * @param {{ status?: string, decrypt?: boolean, database?: Dexie }} [options]
 * @throws {StorageError} INVALID_INPUT, DB_UNAVAILABLE, CORRUPTED (clave), OPERATION_FAILED
 */
export function listTickets({ status, decrypt = false, database = db } = {}) {
  return guard(async () => {
    let records;
    if (status !== undefined) {
      assertStatus(status);
      records = await database.tickets.where("status").equals(status).toArray();
    } else {
      records = await database.tickets.toArray();
    }

    if (!decrypt) {
      return records.map(({ ticketId, status, updatedAt, last_synced_at }) =>
        ({ ticketId, status, updatedAt, last_synced_at }));
    }
    const key = await getOrCreateStorageKey(database);
    return Promise.all(records.map((r) =>
      openRecord(r, key).catch((err) => ({ ticketId: r.ticketId, status: r.status, error: err.code }))));
  });
}

/**
 * Cambia el estado de un boleto sin volver a cifrarlo.
 * @returns {Promise<boolean>} true si el boleto existia
 * @throws {StorageError} INVALID_INPUT, DB_UNAVAILABLE, OPERATION_FAILED
 */
export function updateTicketStatus(ticketId, status, { database = db } = {}) {
  return guard(async () => {
    assertTicketId(ticketId);
    assertStatus(status);
    const changed = await database.tickets.update(ticketId, { status, updatedAt: Date.now() });
    return changed === 1;
  }, ticketId);
}

/**
 * Elimina un boleto.
 * @returns {Promise<boolean>} true si el boleto existia
 * @throws {StorageError} INVALID_INPUT, DB_UNAVAILABLE, OPERATION_FAILED
 */
export function deleteTicket(ticketId, { database = db } = {}) {
  return guard(async () => {
    assertTicketId(ticketId);
    return database.transaction("rw", database.tickets, async () => {
      const existed = (await database.tickets.get(ticketId)) !== undefined;
      await database.tickets.delete(ticketId);
      return existed;
    });
  }, ticketId);
}
