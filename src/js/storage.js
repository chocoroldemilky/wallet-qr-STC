/*
OBJETIVO:
Gestionar la persistencia local de los boletos y sus datos cifrados.

RESPONSABILIDADES:
- Guardar y recuperar boletos cifrados con AES-GCM (IndexedDB con Dexie).
- Generar y guardar la clave AES local.
- Gestionar errores de lectura, escritura y descifrado (StorageError con codigo).

CONSIDERACIONES DE SEGURIDAD:
- Solo ticketId y status se guardan en claro; el resto del boleto va cifrado (incluye skSession y firma).
- La clave AES es no extraible: se puede usar pero no leer.
- El status local es informativo; la validacion final la hace el validador.

Responsable: Francisco Omar Gutierrez Silva (Modulo 5)
*/

import Dexie from "./vendor/dexie.mjs";
import { generateAESKey, encryptTicket, decryptTicket, CryptoError, ERR as CRYPTO_ERR } from "./cripto.js";

export const DB_NAME = "walletDB";

export const TICKET_STATUS = Object.freeze({
  ACTIVO: "ACTIVO",
  USADO: "USADO",
  CANCELADO: "CANCELADO",
  PENDIENTE_SINCRO: "PENDIENTE_SINCRO",
});

// tickets: ticketId, status, iv, ciphertext, updatedAt, last_synced_at
// keys: id, key (CryptoKey), createdAt
// Si se agregan campos en claro, crear version(2) en lugar de cambiar la 1.
export function createDB(name = DB_NAME) {
  const db = new Dexie(name);
  db.version(1).stores({
    tickets: "ticketId, status, updatedAt",
    keys: "id",
  });
  return db;
}

export const db = createDB();

// ---------- Errores ----------
export const STORAGE_ERR = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",       // boleto, ticketId o status incorrecto
  DB_UNAVAILABLE: "DB_UNAVAILABLE",     // IndexedDB no disponible
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",     // sin espacio
  DECRYPT_FAILED: "DECRYPT_FAILED",     // clave incorrecta o datos alterados
  CORRUPTED: "CORRUPTED",               // registro o clave invalidos
  OPERATION_FAILED: "OPERATION_FAILED",
});

// El mensaje nunca incluye datos del boleto ni claves.
export class StorageError extends Error {
  constructor(code, message, { cause, ticketId } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "StorageError";
    this.code = code;
    if (ticketId !== undefined) this.ticketId = ticketId;
  }
}

const DB_UNAVAILABLE_NAMES = new Set([
  "MissingAPIError", "OpenFailedError", "DatabaseClosedError", "InvalidStateError",
  "VersionError", "UpgradeError", "SecurityError", "InvalidAccessError",
]);

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

  // Dexie guarda el error original en "inner"
  const names = [err?.name, err?.inner?.name];
  if (names.includes("QuotaExceededError")) {
    return new StorageError(STORAGE_ERR.QUOTA_EXCEEDED, "No hay espacio suficiente para guardar los boletos", opts);
  }
  if (names.some((n) => DB_UNAVAILABLE_NAMES.has(n))) {
    return new StorageError(STORAGE_ERR.DB_UNAVAILABLE, "El almacenamiento local no esta disponible", opts);
  }
  return new StorageError(STORAGE_ERR.OPERATION_FAILED, "Fallo una operacion de almacenamiento", opts);
}

async function guard(fn, ticketId) {
  try {
    return await fn();
  } catch (err) {
    throw toStorageError(err, ticketId);
  }
}

// Para comprobar al iniciar la app que se puede usar IndexedDB.
export function openStorage(database = db) {
  return guard(async () => {
    await database.open();
    return true;
  });
}

// ---------- Clave AES local ----------
export const STORAGE_KEY_ID = "storage-aes";

// Evita generar dos claves si se llama varias veces al mismo tiempo.
const keyCache = new WeakMap();

export function getOrCreateStorageKey(database = db) {
  if (!keyCache.has(database)) {
    const pending = guard(() => loadOrCreateKey(database)).catch((err) => {
      keyCache.delete(database); // permite reintentar
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

  // Se genera fuera de una transaccion: Dexie la cierra si se espera a crypto.subtle
  const key = await generateAESKey(false);
  try {
    await database.keys.add({ id: STORAGE_KEY_ID, key, createdAt: Date.now() });
    return key;
  } catch (err) {
    // otra pestana la guardo primero
    if (err?.name === "ConstraintError") {
      return assertStoredKey(await database.keys.get(STORAGE_KEY_ID));
    }
    throw err;
  }
}

// ---------- Boletos ----------
// Se guarda el objeto tal como llega; solo se exige ticketId. Sin status se usa ACTIVO.

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

function validateTicket(ticket) {
  if (!ticket || typeof ticket !== "object" || Array.isArray(ticket)) {
    throw invalid("El boleto debe ser un objeto");
  }
  assertTicketId(ticket.ticketId);
  const status = ticket.status ?? TICKET_STATUS.ACTIVO;
  assertStatus(status);
  return status;
}

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

// Tambien revisa que el contenido sea de ese ticketId (evita intercambiar cifrados entre boletos).
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

// Guarda o reemplaza un boleto. syncedAt: fecha de sincronizacion con el servidor (ms) o null.
export function saveTicket(ticket, { syncedAt = null, database = db } = {}) {
  return guard(async () => {
    validateTicket(ticket);
    const key = await getOrCreateStorageKey(database);
    const record = await buildRecord(ticket, key, syncedAt);
    await database.tickets.put(record);
    return { ticketId: record.ticketId, status: record.status };
  }, ticket?.ticketId);
}

// Guarda varios boletos: se guardan todos o ninguno.
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

// Regresa el boleto descifrado o null si no existe.
export function getTicket(ticketId, { database = db } = {}) {
  return guard(async () => {
    assertTicketId(ticketId);
    const record = await database.tickets.get(ticketId);
    if (!record) return null;
    const key = await getOrCreateStorageKey(database);
    return openRecord(record, key);
  }, ticketId);
}

// Sin decrypt solo regresa los datos en claro. Con decrypt, un boleto danado
// viene como { ticketId, status, error } y no bloquea a los demas.
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

// Cambia el status sin volver a cifrar. Regresa false si no existe.
export function updateTicketStatus(ticketId, status, { database = db } = {}) {
  return guard(async () => {
    assertTicketId(ticketId);
    assertStatus(status);
    const changed = await database.tickets.update(ticketId, { status, updatedAt: Date.now() });
    return changed === 1;
  }, ticketId);
}

// Regresa false si no existe.
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
