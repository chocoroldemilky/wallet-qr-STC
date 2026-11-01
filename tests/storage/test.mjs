// Ejecutar: npm run test:storage
import "fake-indexeddb/auto"; // IndexedDB simulada, antes de importar storage.js
import * as S from "../../src/js/storage.js";
import * as C from "../../src/js/cripto.js";

const results = [];
async function test(group, name, fn) {
  let pass = false, detail = "";
  try {
    const got = await fn();
    pass = got === true;
    if (!pass) detail = ` (obtuvo: ${JSON.stringify(got)})`;
  } catch (e) {
    detail = ` (excepcion: ${e?.name} ${e?.code ?? ""} ${e?.message})`;
  }
  results.push({ group, name, pass, detail });
}

async function codeOf(fn) {
  try { await fn(); return "sin error"; }
  catch (e) { return e instanceof S.StorageError ? e.code : `otro error: ${e?.name}`; }
}
const E = S.STORAGE_ERR;
let dbCount = 0;
const newDB = () => S.createDB(`prueba-${++dbCount}`);
const flip = (b64) => (b64[0] === "A" ? "B" : "A") + b64.slice(1);

// --- Boletos de prueba (formato del mock y del contrato de apiRest) ---
const mockTicket = {
  ticketId: "BOL-001", event: "Concierto de prueba", date: "10/11/2026", seat: "A12",
  titular: "Usuario de prueba", skSession: "SK_SESSION_TEST_9988776654321",
  signatureECDSA: "MEYCIQDx...mock==", status: "ACTIVO",
};
const contractTicket = {
  ticketId: "BOL-002",
  eventDetails: { name: "Concierto de prueba", date: "10/11/2026", seat: "B3", holder: "Usuario de prueba" },
  skSession: "A1B2C3D4E5F67890123456789ABCDEF0", signatureECDSA: "3045...f42",
};

// ---------- Esquema ----------
{
  const G = "Esquema";
  const db = newDB();
  await db.open();
  const t = Object.fromEntries(db.tables.map((x) => [x.name, x.schema]));
  await test(G, "tabla tickets: clave primaria ticketId, indices status y updatedAt", async () =>
    t.tickets.primKey.name === "ticketId" &&
    t.tickets.indexes.map((i) => i.name).sort().join() === "status,updatedAt");
  await test(G, "tabla keys: clave primaria id", async () => t.keys.primKey.name === "id");
  await test(G, "la instancia de la app usa la base walletDB", async () => S.db.name === "walletDB");
  await test(G, "openStorage con IndexedDB disponible -> true", async () => (await S.openStorage(db)) === true);
}

// ---------- Clave AES local ----------
{
  const G = "Clave AES";
  const db = newDB();
  const k = await S.getOrCreateStorageKey(db);
  await test(G, "crea una clave AES-GCM no extraible", async () =>
    k instanceof CryptoKey && k.algorithm.name === "AES-GCM" && k.extractable === false);
  await test(G, "la segunda llamada reutiliza la misma clave", async () => (await S.getOrCreateStorageKey(db)) === k);
  await test(G, "solo se guarda una clave", async () => (await db.keys.count()) === 1);

  // simula recargar la pagina
  db.close();
  const reopened = S.createDB(db.name);
  await test(G, "tras recargar, la clave guardada descifra lo cifrado antes", async () => {
    const rec = await C.encryptTicket({ ticketId: "BOL-001" }, k);
    const k2 = await S.getOrCreateStorageKey(reopened);
    return (await C.decryptTicket(rec, k2)).ticketId === "BOL-001";
  });

  const name = `prueba-${++dbCount}`;
  const tabA = S.createDB(name), tabB = S.createDB(name);
  const [ka, kb] = await Promise.all([S.getOrCreateStorageKey(tabA), S.getOrCreateStorageKey(tabB)]);
  await test(G, "dos pestanas simultaneas guardan una sola clave", async () => (await tabA.keys.count()) === 1);
  await test(G, "dos pestanas simultaneas usan la misma clave", async () => {
    const rec = await C.encryptTicket({ x: 1 }, ka);
    return (await C.decryptTicket(rec, kb)).x === 1;
  });
  await test(G, "otra base tiene otra clave (no puede descifrar)", async () => {
    const rec = await C.encryptTicket({ x: 1 }, ka);
    const other = await S.getOrCreateStorageKey(newDB());
    try { await C.decryptTicket(rec, other); return false; } catch (e) { return e.code === C.ERR.DECRYPT_FAILED; }
  });
}

// ---------- Guardar, consultar y recuperar ----------
{
  const G = "Operaciones";
  const database = newDB();
  const o = { database };

  await test(G, "saveTicket guarda un boleto (formato mock)", async () =>
    JSON.stringify(await S.saveTicket(mockTicket, o)) === '{"ticketId":"BOL-001","status":"ACTIVO"}');
  await test(G, "saveTicket sin status usa ACTIVO (formato contrato)", async () =>
    (await S.saveTicket(contractTicket, o)).status === "ACTIVO");
  await test(G, "getTicket descifra el boleto completo", async () => {
    const t = await S.getTicket("BOL-001", o);
    return t.seat === "A12" && t.skSession === mockTicket.skSession && t.signatureECDSA === mockTicket.signatureECDSA;
  });
  await test(G, "getTicket conserva objetos anidados", async () =>
    (await S.getTicket("BOL-002", o)).eventDetails.seat === "B3");
  await test(G, "getTicket de un boleto inexistente -> null", async () =>
    (await S.getTicket("NO-EXISTE", o)) === null);

  await test(G, "listTickets sin descifrar regresa solo datos en claro", async () => {
    const list = await S.listTickets(o);
    return list.length === 2 && list.every((t) =>
      Object.keys(t).sort().join() === "last_synced_at,status,ticketId,updatedAt");
  });
  await test(G, "listTickets con decrypt: true regresa boletos completos", async () =>
    (await S.listTickets({ ...o, decrypt: true })).every((t) => typeof t.skSession === "string"));

  await test(G, "updateTicketStatus cambia el estado", async () =>
    (await S.updateTicketStatus("BOL-001", "USADO", o)) === true);
  await test(G, "al leer manda el status en claro", async () =>
    (await S.getTicket("BOL-001", o)).status === "USADO");
  await test(G, "listTickets filtra por status", async () =>
    (await S.listTickets({ ...o, status: "USADO" })).map((t) => t.ticketId).join() === "BOL-001");
  await test(G, "updateTicketStatus de un boleto inexistente -> false", async () =>
    (await S.updateTicketStatus("NO-EXISTE", "USADO", o)) === false);

  await test(G, "saveTickets guarda varios boletos", async () =>
    (await S.saveTickets([{ ticketId: "BOL-003" }, { ticketId: "BOL-004", status: "CANCELADO" }],
      { ...o, syncedAt: 1730000000000 })) === 2);
  await test(G, "saveTickets registra last_synced_at", async () =>
    (await database.tickets.get("BOL-003")).last_synced_at === 1730000000000);
  await test(G, "saveTickets es todo o nada: con un boleto invalido no guarda ninguno", async () =>
    (await codeOf(() => S.saveTickets([{ ticketId: "BOL-005" }, { sinId: true }], o))) === E.INVALID_INPUT &&
    (await S.getTicket("BOL-005", o)) === null);

  await test(G, "saveTicket con el mismo ticketId reemplaza el boleto", async () => {
    await S.saveTicket({ ...mockTicket, seat: "A13" }, o);
    return (await S.getTicket("BOL-001", o)).seat === "A13";
  });
  await test(G, "deleteTicket elimina -> true", async () => (await S.deleteTicket("BOL-003", o)) === true);
  await test(G, "deleteTicket de un boleto inexistente -> false", async () => (await S.deleteTicket("BOL-003", o)) === false);
}

// ---------- Confidencialidad e integridad ----------
{
  const G = "Seguridad";
  const database = newDB();
  const o = { database };
  await S.saveTicket(mockTicket, o);
  await S.saveTicket(contractTicket, o);
  const r1 = await database.tickets.get("BOL-001");
  const r2 = await database.tickets.get("BOL-002");

  await test(G, "en IndexedDB no hay datos sensibles en claro", async () => {
    const raw = JSON.stringify(await database.tickets.toArray());
    return ["SK_SESSION", "A1B2C3D4", "A12", "Concierto", "MEYCIQ", "Usuario"].every((s) => !raw.includes(s));
  });
  await test(G, "el registro solo tiene ticketId y status en claro, mas iv, ciphertext y fechas", async () =>
    Object.keys(r1).sort().join() === "ciphertext,iv,last_synced_at,status,ticketId,updatedAt");
  await test(G, "cada cifrado usa un IV distinto", async () => {
    await S.saveTicket(mockTicket, o);
    return (await database.tickets.get("BOL-001")).iv !== r1.iv;
  });
  await test(G, "ciphertext alterado -> DECRYPT_FAILED", async () => {
    await database.tickets.put({ ...r1, ciphertext: flip(r1.ciphertext) });
    return (await codeOf(() => S.getTicket("BOL-001", o))) === E.DECRYPT_FAILED;
  });
  await test(G, "IV alterado -> DECRYPT_FAILED", async () => {
    await database.tickets.put({ ...r1, iv: flip(r1.iv) });
    return (await codeOf(() => S.getTicket("BOL-001", o))) === E.DECRYPT_FAILED;
  });
  await test(G, "contenido cifrado intercambiado entre boletos -> CORRUPTED", async () => {
    await database.tickets.put({ ...r2, iv: r1.iv, ciphertext: r1.ciphertext });
    return (await codeOf(() => S.getTicket("BOL-002", o))) === E.CORRUPTED;
  });
  await test(G, "los mensajes de error no filtran datos del boleto", async () => {
    await database.tickets.put({ ...r1, ciphertext: flip(r1.ciphertext) });
    try { await S.getTicket("BOL-001", o); return false; }
    catch (e) {
      return e.ticketId === "BOL-001" &&
        ["SK_SESSION", "A12", "Concierto"].every((s) => !String(e.message).includes(s) && !String(e.stack).includes(s));
    }
  });
}

// ---------- Manejo de errores ----------
{
  const G = "Errores";
  const database = newDB();
  const o = { database };
  await S.saveTicket(mockTicket, o);

  const invalidCases = [
    ["boleto sin ticketId", () => S.saveTicket({ seat: "x" }, o)],
    ["boleto que no es objeto", () => S.saveTicket("texto", o)],
    ["boleto null", () => S.saveTicket(null, o)],
    ["ticketId vacio", () => S.saveTicket({ ticketId: "   " }, o)],
    ["status invalido", () => S.saveTicket({ ticketId: "X", status: "VIP" }, o)],
    ["saveTickets sin arreglo", () => S.saveTickets("no arreglo", o)],
    ["getTicket con id numerico", () => S.getTicket(42, o)],
    ["updateTicketStatus con status invalido", () => S.updateTicketStatus("BOL-001", "otro", o)],
    ["deleteTicket con id vacio", () => S.deleteTicket("", o)],
    ["listTickets con status invalido", () => S.listTickets({ ...o, status: "x" })],
  ];
  for (const [name, fn] of invalidCases) {
    await test(G, `${name} -> INVALID_INPUT`, async () => (await codeOf(fn)) === E.INVALID_INPUT);
  }

  await test(G, "registro sin iv/ciphertext validos -> CORRUPTED", async () => {
    await database.tickets.put({ ticketId: "BOL-010", status: "ACTIVO", iv: 5 });
    return (await codeOf(() => S.getTicket("BOL-010", o))) === E.CORRUPTED;
  });
  await test(G, "contenido descifrado que no es JSON -> CORRUPTED", async () => {
    const key = await S.getOrCreateStorageKey(database);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("no es json"));
    await database.tickets.put({ ticketId: "BOL-011", status: "ACTIVO", iv: C.toB64u(iv), ciphertext: C.toB64u(ct) });
    return (await codeOf(() => S.getTicket("BOL-011", o))) === E.CORRUPTED;
  });
  await test(G, "listTickets con decrypt: los boletos danados traen error y los demas llegan completos", async () => {
    const list = Object.fromEntries((await S.listTickets({ ...o, decrypt: true })).map((t) => [t.ticketId, t]));
    return list["BOL-001"].skSession === mockTicket.skSession &&
      list["BOL-010"].error === E.CORRUPTED && list["BOL-011"].error === E.CORRUPTED;
  });

  await test(G, "clave guardada que no es CryptoKey -> CORRUPTED", async () => {
    const db = newDB();
    await db.keys.put({ id: S.STORAGE_KEY_ID, key: "no es una clave" });
    return (await codeOf(() => S.saveTicket({ ticketId: "X" }, { database: db }))) === E.CORRUPTED;
  });
  await test(G, "clave guardada de otro tipo (HMAC) -> CORRUPTED", async () => {
    const db = newDB();
    const hmac = await crypto.subtle.importKey("raw", new Uint8Array(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    await db.keys.put({ id: S.STORAGE_KEY_ID, key: hmac });
    return (await codeOf(() => S.getOrCreateStorageKey(db))) === E.CORRUPTED;
  });

  // fallos del navegador simulados
  await test(G, "sin espacio (QuotaExceededError) -> QUOTA_EXCEEDED", async () => {
    const db = newDB();
    await S.getOrCreateStorageKey(db);
    db.tickets.put = async () => { throw new DOMException("lleno", "QuotaExceededError"); };
    return (await codeOf(() => S.saveTicket({ ticketId: "Q" }, { database: db }))) === E.QUOTA_EXCEEDED;
  });
  await test(G, "sin espacio envuelto por Dexie (inner) -> QUOTA_EXCEEDED", async () => {
    const db = newDB();
    await S.getOrCreateStorageKey(db);
    db.tickets.bulkPut = async () => {
      const e = new Error("transaccion abortada"); e.name = "AbortError";
      e.inner = new DOMException("lleno", "QuotaExceededError"); throw e;
    };
    return (await codeOf(() => S.saveTickets([{ ticketId: "Q" }], { database: db }))) === E.QUOTA_EXCEEDED;
  });
  await test(G, "base cerrada -> DB_UNAVAILABLE", async () => {
    const db = newDB();
    await db.open();
    db.close({ disableAutoOpen: true });
    return (await codeOf(() => S.listTickets({ database: db }))) === E.DB_UNAVAILABLE;
  });
  await test(G, "navegador sin IndexedDB: openStorage -> DB_UNAVAILABLE", async () => {
    const db = newDB();
    db.open = async () => { const e = new Error("IndexedDB API missing"); e.name = "MissingAPIError"; throw e; };
    return (await codeOf(() => S.openStorage(db))) === E.DB_UNAVAILABLE;
  });
  await test(G, "fallo desconocido -> OPERATION_FAILED, y despues se puede reintentar", async () => {
    const db = newDB();
    const realGet = db.keys.get.bind(db.keys);
    let calls = 0;
    db.keys.get = (...args) => {
      if (calls++ === 0) { const e = new Error("x"); e.name = "UnknownError"; return Promise.reject(e); }
      return realGet(...args);
    };
    const first = await codeOf(() => S.getOrCreateStorageKey(db));
    return first === E.OPERATION_FAILED && (await S.getOrCreateStorageKey(db)) instanceof CryptoKey;
  });
}

// ---------- Resultados ----------
let fails = 0;
for (const r of results) {
  if (!r.pass) fails++;
  console.log(`${r.pass ? "OK   " : "FALLO"} | ${r.group.padEnd(11)} | ${r.name}${r.detail}`);
}
console.log(`\n${results.length - fails}/${results.length} pruebas correctas`);
process.exit(fails ? 1 : 0);
