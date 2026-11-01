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
import { generateAESKey } from "./cripto.js";

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
