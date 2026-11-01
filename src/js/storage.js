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
import { generateAESKey, encryptTicket, decryptTicket } from "./cripto.js";

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
    const pending = loadOrCreateKey(database).catch((err) => {
      keyCache.delete(database); // permitir reintentar despues de un error
      throw err;
    });
    keyCache.set(database, pending);
  }
  return keyCache.get(database);
}

async function loadOrCreateKey(database) {
  const existing = await database.keys.get(STORAGE_KEY_ID);
  if (existing) return existing.key;

  // La clave se genera fuera de la transaccion: Dexie cierra la transaccion si se espera
  // una operacion que no es de IndexedDB (como crypto.subtle).
  const key = await generateAESKey(false);
  try {
    await database.keys.add({ id: STORAGE_KEY_ID, key, createdAt: Date.now() });
    return key;
  } catch (err) {
    // Otra pestana la creo primero: usar la suya para que todas cifren con la misma clave.
    if (err?.name === "ConstraintError") {
      return (await database.keys.get(STORAGE_KEY_ID)).key;
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

function assertTicketId(ticketId) {
  if (typeof ticketId !== "string" || ticketId.trim() === "") {
    throw new TypeError("ticketId debe ser un texto no vacio");
  }
}

function assertStatus(status) {
  if (!Object.values(TICKET_STATUS).includes(status)) {
    throw new TypeError(`status invalido; valores permitidos: ${Object.values(TICKET_STATUS).join(", ")}`);
  }
}

// Construye el registro cifrado que se guarda en la tabla tickets.
async function buildRecord(ticket, key, syncedAt) {
  if (!ticket || typeof ticket !== "object" || Array.isArray(ticket)) {
    throw new TypeError("El boleto debe ser un objeto");
  }
  assertTicketId(ticket.ticketId);
  const status = ticket.status ?? TICKET_STATUS.ACTIVO;
  assertStatus(status);

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
  const ticket = await decryptTicket(record, key);
  if (ticket?.ticketId !== record.ticketId) {
    throw new Error("El contenido cifrado no corresponde al boleto");
  }
  return { ...ticket, status: record.status };
}

/**
 * Guarda (o reemplaza) un boleto cifrado.
 * @param {object} ticket  boleto con al menos ticketId
 * @param {{ syncedAt?: number|null, database?: Dexie }} [options]
 *        syncedAt: momento de la sincronizacion con el servidor (ms); null si es solo local
 * @returns {Promise<{ticketId: string, status: string}>}
 */
export async function saveTicket(ticket, { syncedAt = null, database = db } = {}) {
  const key = await getOrCreateStorageKey(database);
  const record = await buildRecord(ticket, key, syncedAt);
  await database.tickets.put(record);
  return { ticketId: record.ticketId, status: record.status };
}

/**
 * Guarda varios boletos (p. ej. la respuesta del Modulo 4) en una sola transaccion:
 * o se guardan todos o ninguno. Se cifran antes de abrir la transaccion.
 * @returns {Promise<number>} cantidad de boletos guardados
 */
export async function saveTickets(tickets, { syncedAt = null, database = db } = {}) {
  if (!Array.isArray(tickets)) throw new TypeError("Se esperaba un arreglo de boletos");
  const key = await getOrCreateStorageKey(database);
  const records = await Promise.all(tickets.map((t) => buildRecord(t, key, syncedAt)));
  await database.tickets.bulkPut(records);
  return records.length;
}

/**
 * Recupera y descifra un boleto.
 * @returns {Promise<object|null>} el boleto completo, o null si no existe
 */
export async function getTicket(ticketId, { database = db } = {}) {
  assertTicketId(ticketId);
  const record = await database.tickets.get(ticketId);
  if (!record) return null;
  const key = await getOrCreateStorageKey(database);
  return openRecord(record, key);
}

/**
 * Lista los boletos guardados.
 * Por defecto NO descifra: regresa solo los datos en claro (rapido, para la vista de lista).
 * Con decrypt: true regresa los boletos completos.
 * @param {{ status?: string, decrypt?: boolean, database?: Dexie }} [options]
 */
export async function listTickets({ status, decrypt = false, database = db } = {}) {
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
  return Promise.all(records.map((r) => openRecord(r, key)));
}

/**
 * Cambia el estado de un boleto sin volver a cifrarlo.
 * @returns {Promise<boolean>} true si el boleto existia
 */
export async function updateTicketStatus(ticketId, status, { database = db } = {}) {
  assertTicketId(ticketId);
  assertStatus(status);
  const changed = await database.tickets.update(ticketId, { status, updatedAt: Date.now() });
  return changed === 1;
}

/**
 * Elimina un boleto.
 * @returns {Promise<boolean>} true si el boleto existia
 */
export async function deleteTicket(ticketId, { database = db } = {}) {
  assertTicketId(ticketId);
  return database.transaction("rw", database.tickets, async () => {
    const existed = (await database.tickets.get(ticketId)) !== undefined;
    await database.tickets.delete(ticketId);
    return existed;
  });
}
