// Ejecutar: npm run test:integracion
// Flujo de la wallet sin interfaz: emisor de prueba -> storage (AES-GCM) -> wallet (ECDSA) -> QR dinamico (HMAC).
import "fake-indexeddb/auto"; // IndexedDB simulada, antes de importar storage.js
import * as S from "../../src/js/storage.js";
import * as C from "../../src/js/cripto.js";
import * as W from "../../src/js/wallet.js";
import * as Q from "../../src/js/qr-dinamico.js";
import { DEMO_TICKETS, issueDemoTickets } from "../../src/js/emisor-prueba.js";

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

const T = W.TICKET_STATE;
let dbCount = 0;
const newDB = () => S.createDB(`integracion-${++dbCount}`);
const flip = (b64) => (b64[0] === "A" ? "B" : "A") + b64.slice(1);
const ids = (list) => list.map((t) => t.ticketId).sort().join();

// ---------- Inicio de la wallet ----------
{
  const G = "Inicio";
  const database = newDB();
  const o = { database };
  await W.initWallet(o);

  await test(G, "wallet vacia: guarda cifrados los boletos del emisor de prueba", async () =>
    ids(await S.listTickets(o)) === ids(DEMO_TICKETS));
  await test(G, "guarda la clave publica del emisor, sin parte privada", async () => {
    const { jwk } = await database.keys.get(W.ISSUER_KEY_ID);
    return jwk.kty === "EC" && jwk.crv === "P-256" && !("d" in jwk);
  });
  const before = JSON.stringify(await database.tickets.toArray());
  await W.initWallet(o);
  await test(G, "al recargar no vuelve a generar boletos", async () =>
    JSON.stringify(await database.tickets.toArray()) === before);
  await test(G, "con seedDemo: false no agrega boletos de prueba", async () => {
    const empty = newDB();
    await W.initWallet({ database: empty, seedDemo: false });
    return (await S.listTickets({ database: empty })).length === 0;
  });
  await test(G, "dos pestanas a la vez: los boletos verifican con la clave guardada", async () => {
    const name = `integracion-${++dbCount}`;
    const [tabA, tabB] = [S.createDB(name), S.createDB(name)];
    await Promise.all([W.initWallet({ database: tabA }), W.initWallet({ database: tabB })]);
    const loaded = await Promise.all(DEMO_TICKETS.map((t) => W.loadTicket(t.ticketId, { database: tabB })));
    return loaded.every((r) => r.state === T.VALID);
  });
}

// ---------- Pantallas: lista y detalle ----------
{
  const G = "Pantallas";
  const o = { database: newDB() };
  await W.initWallet(o);
  const list = await W.loadTicketList(o);
  const detail = await W.loadTicket("BOL-001", o);

  await test(G, "la lista muestra los datos del boleto del front", async () => {
    const t = list.find((x) => x.ticketId === "BOL-001");
    return t.name === "Concierto de prueba" && t.date === "10/11/2026" && t.seat === "A12" &&
      t.holder === "Usuario de prueba";
  });
  await test(G, "la lista no incluye la SK_session ni la firma", async () =>
    list.every((t) => !("skSession" in t) && !("signatureECDSA" in t)));
  await test(G, "detalle con firma ECDSA correcta -> VALIDO", async () => detail.state === T.VALID);
  await test(G, "el detalle valido trae la SK_session para el QR", async () =>
    typeof detail.ticket.skSession === "string" && detail.view.name === "Concierto de prueba");
  await test(G, "boleto inexistente -> NO_DISPONIBLE", async () =>
    (await W.loadTicket("NO-EXISTE", o)).state === T.UNAVAILABLE);
  await test(G, "describeTicket: formato del contrato del Modulo 4 (event, date, seat, titular)", async () => {
    const v = W.describeTicket({ ticketId: "X", event: "Ev", date: "D", seat: "A12", titular: "U", status: "ACTIVO" });
    return v.name === "Ev" && v.date === "D" && v.seat === "A12" && v.holder === "U";
  });
  await test(G, "describeTicket: formato anterior del contrato (eventDetails)", async () => {
    const v = W.describeTicket({ ticketId: "X", eventDetails: { name: "Ev", date: "D", seat: "B3", holder: "U" } });
    return v.name === "Ev" && v.date === "D" && v.seat === "B3" && v.holder === "U";
  });
  await test(G, "describeTicket: formato de prueba de cripto (evento, fecha, asiento)", async () => {
    const v = W.describeTicket({ ticketId: "X", evento: "Ev", fecha: "D", asiento: "A12", titular: "U" });
    return v.name === "Ev" && v.date === "D" && v.seat === "A12";
  });
}

// ---------- AES-GCM en IndexedDB ----------
{
  const G = "AES-GCM";
  const database = newDB();
  const o = { database };
  await W.initWallet(o);
  const t = await S.getTicket("BOL-001", o);

  await test(G, "en IndexedDB no quedan en claro datos, firma ni SK_session", async () => {
    const raw = JSON.stringify(await database.tickets.toArray());
    return ["Concierto de prueba", "Auditorio Nacional", "Usuario de prueba", t.signatureECDSA, t.skSession]
      .every((s) => !raw.includes(s));
  });
  const rec = await database.tickets.get("BOL-001");
  await database.tickets.put({ ...rec, ciphertext: flip(rec.ciphertext) });
  await test(G, "ciphertext alterado -> NO_DISPONIBLE con DECRYPT_FAILED", async () => {
    const r = await W.loadTicket("BOL-001", o);
    return r.state === T.UNAVAILABLE && r.error === S.STORAGE_ERR.DECRYPT_FAILED;
  });
  await test(G, "la lista marca el boleto danado y muestra los demas", async () => {
    const list = await W.loadTicketList(o);
    return list.find((x) => x.ticketId === "BOL-001").error === S.STORAGE_ERR.DECRYPT_FAILED &&
      list.find((x) => x.ticketId === "BOL-002").name === "Auditorio Nacional";
  });
}

// ---------- Firma ECDSA ----------
{
  const G = "ECDSA";
  const database = newDB();
  const o = { database };
  await W.initWallet(o);
  const original = await S.getTicket("BOL-001", o);
  const saveAndLoad = async (ticket) => {
    await S.saveTicket(ticket, o);
    return W.loadTicket(ticket.ticketId, o);
  };

  await test(G, "datos alterados (asiento) -> INVALIDO", async () =>
    (await saveAndLoad({ ...original, seat: "VIP-01" })).state === T.INVALID);
  await test(G, "firma de otro emisor -> INVALIDO", async () => {
    const { tickets } = await issueDemoTickets();
    return (await saveAndLoad(tickets.find((x) => x.ticketId === "BOL-001"))).state === T.INVALID;
  });
  await test(G, "boleto sin firma -> INVALIDO", async () => {
    const { signatureECDSA, ...unsigned } = original;
    return (await saveAndLoad(unsigned)).state === T.INVALID;
  });
  await test(G, "un boleto INVALIDO no entrega la SK_session", async () =>
    !("ticket" in (await W.loadTicket("BOL-001", o))));
  await test(G, "boleto original restaurado -> VALIDO", async () =>
    (await saveAndLoad(original)).state === T.VALID);
  await test(G, "cambiar el status local no invalida la firma", async () => {
    await S.updateTicketStatus("BOL-002", S.TICKET_STATUS.USADO, o);
    const r = await W.loadTicket("BOL-002", o);
    return r.state === T.VALID && r.view.status === "USADO";
  });
  await test(G, "sin clave publica del emisor -> INVALIDO (no se puede verificar)", async () => {
    await database.keys.delete(W.ISSUER_KEY_ID);
    return (await W.loadTicket("BOL-002", o)).state === T.INVALID;
  });
}

// ---------- QR dinamico (HMAC-SHA256) ----------
{
  const G = "QR";
  const o = { database: newDB() };
  await W.initWallet(o);
  const { ticket } = await W.loadTicket("BOL-001", o);
  const other = (await W.loadTicket("BOL-002", o)).ticket;
  const key = await Q.importQRKey(ticket);
  const t0 = Date.UTC(2026, 10, 15, 20, 0, 0); // inicio de una ventana de 15 s
  const qr = await C.generateQRPayload(ticket.ticketId, key, t0);
  // El validador (Modulo 6) usaria la misma SK_session que se entrego con el boleto
  const validatorKey = await C.importSessionKey(C.fromB64u(ticket.skSession));

  await test(G, "formato ticketId.ventana.mac con la ventana actual", async () => {
    const [id, win, mac] = qr.split(".");
    return id === "BOL-001" && Number(win) === C.currentWindow(t0) && mac.length === 43;
  });
  await test(G, "el QR de la wallet verifica con la SK_session del boleto", async () =>
    (await C.verifyQRPayload(qr, validatorKey, t0 + 1000)).valid);
  await test(G, "el QR no cambia dentro de la misma ventana", async () =>
    qr === (await C.generateQRPayload(ticket.ticketId, key, t0 + 14999)));
  await test(G, "el QR cambia en la siguiente ventana (15 s)", async () =>
    qr !== (await C.generateQRPayload(ticket.ticketId, key, t0 + 15000)));
  await test(G, "QR fuera de la tolerancia de +-1 ventana -> expirado", async () =>
    !(await C.verifyQRPayload(qr, validatorKey, t0 + 40000)).valid);
  await test(G, "la SK_session de otro boleto no verifica este QR", async () =>
    !(await C.verifyQRPayload(qr, await C.importSessionKey(C.fromB64u(other.skSession)), t0)).valid);
  await test(G, "boleto sin SK_session: no se genera QR", async () => {
    try { await Q.importQRKey({ ticketId: "X" }); return false; } catch { return true; }
  });
  await test(G, "contador: 15 s al iniciar la ventana y 1 s al final", async () =>
    Q.timeLeft(t0).seconds === 15 && Q.timeLeft(t0).fraction === 1 && Q.timeLeft(t0 + 14500).seconds === 1);
  await test(G, "contador: a los 7.2 s faltan 8 s", async () => Q.timeLeft(t0 + 7200).seconds === 8);
}

// ---------- Resultados ----------
let fails = 0;
for (const r of results) {
  if (!r.pass) fails++;
  console.log(`${r.pass ? "OK   " : "FALLO"} | ${r.group.padEnd(9)} | ${r.name}${r.detail}`);
}
console.log(`\n${results.length - fails}/${results.length} pruebas correctas`);
process.exit(fails ? 1 : 0);
