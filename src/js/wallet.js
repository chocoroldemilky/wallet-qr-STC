/*
OBJETIVO:
Gestionar la informacion y visualizacion de los boletos del usuario.

RESPONSABILIDADES:
- Consultar los boletos disponibles para la wallet (storage.js: IndexedDB cifrado con AES-GCM).
- Preparar la lista de boletos y sus datos principales para las pantallas.
- Presentar los detalles de un boleto seleccionado con su firma ECDSA verificada (cripto.js).
- Gestionar los estados de boleto valido, invalido o no disponible.
- Preparar la recepcion de boletos firmados desde el Modulo 4 (mientras tanto, emisor-prueba.js).

CONSIDERACIONES DE SEGURIDAD:
- La firma cubre los datos del boleto; no cubre la firma misma, la SK_session ni el status local
  (formato provisional, pendiente de acordar con el Modulo 4).
- La clave publica del emisor se guarda en la tabla keys; la wallet nunca tiene la clave privada.
- Solo un boleto con firma valida entrega su SK_session para generar el QR.

DEPENDENCIAS:
storage.js, cripto.js y emisor-prueba.js (solo mientras no este integrado el Modulo 4).
*/

import { db, openStorage, saveTickets, listTickets, getTicket, StorageError } from "./storage.js";
import { importPublicKeyJwk, verifyTicket } from "./cripto.js";
import { issueDemoTickets } from "./emisor-prueba.js";

export { TICKET_STATUS } from "./storage.js";

export const ISSUER_KEY_ID = "issuer-public-key";

export const TICKET_STATE = Object.freeze({
  VALID: "VALIDO",              // firma ECDSA correcta: se muestra el QR
  INVALID: "INVALIDO",          // sin firma, datos alterados, otro emisor o sin clave para verificar
  UNAVAILABLE: "NO_DISPONIBLE", // no existe o no se pudo descifrar
});

// ---------- Inicio ----------
// Abre IndexedDB y, si la wallet esta vacia, guarda los boletos del emisor de prueba.
export async function initWallet({ seedDemo = true, database = db } = {}) {
  await openStorage(database);
  if (seedDemo && (await listTickets({ database })).length === 0) {
    await saveDemoTickets(database);
  }
}

async function saveDemoTickets(database) {
  const { tickets, publicKeyJwk } = await issueDemoTickets();
  try {
    await database.keys.add({ id: ISSUER_KEY_ID, jwk: publicKeyJwk, createdAt: Date.now() });
  } catch (err) {
    if (err?.name === "ConstraintError") return; // otra pestana ya guardo los boletos de prueba
    throw err;
  }
  try {
    await saveTickets(tickets, { syncedAt: Date.now(), database });
  } catch (err) {
    await database.keys.delete(ISSUER_KEY_ID).catch(() => {}); // permite reintentar en la siguiente carga
    throw err;
  }
}

// ---------- Firma del emisor ----------
// Datos que firma el emisor: el boleto sin la firma, sin la SK_session y sin el status local.
export function signedData(ticket) {
  const { signatureECDSA, skSession, status, ...data } = ticket;
  return data;
}

async function issuerKey(database) {
  const entry = await database.keys.get(ISSUER_KEY_ID);
  return entry?.jwk ? importPublicKeyJwk(entry.jwk) : null;
}

// Regresa por que la firma no es valida, o null si es valida.
async function signatureProblem(ticket, database) {
  if (typeof ticket.signatureECDSA !== "string") return "El boleto no trae firma ECDSA";
  const key = await issuerKey(database).catch(() => null);
  if (!key) return "No hay una clave pública confiable del emisor para verificar la firma";
  const valid = await verifyTicket(signedData(ticket), ticket.signatureECDSA, key);
  return valid ? null : "La firma ECDSA no corresponde a los datos del boleto";
}

// ---------- Datos para las pantallas ----------
// Une los formatos de boleto usados hasta ahora: contrato del Modulo 4 y mock de storage
// (event, date, seat, titular), version anterior del contrato (eventDetails) y prueba de cripto (evento, fecha, asiento).
export function describeTicket(ticket) {
  const d = ticket.eventDetails ?? {};
  return {
    ticketId: ticket.ticketId,
    name: d.name ?? ticket.event ?? ticket.evento ?? `Boleto ${ticket.ticketId}`,
    date: d.date ?? ticket.date ?? ticket.fecha ?? "",
    seat: d.seat ?? ticket.seat ?? ticket.asiento ?? "",
    holder: d.holder ?? ticket.titular ?? "",
    status: ticket.status,
  };
}

// Lista "Mis boletos". Un boleto danado llega como { ticketId, status, error } y no bloquea a los demas.
export async function loadTicketList({ database = db } = {}) {
  const tickets = await listTickets({ decrypt: true, database });
  return tickets.map((t) => (t.error ? { ticketId: t.ticketId, status: t.status, error: t.error } : describeTicket(t)));
}

// Detalle: descifra el boleto y verifica su firma. Solo un boleto VALIDO trae el boleto completo (con SK_session).
export async function loadTicket(ticketId, { database = db } = {}) {
  let ticket;
  try {
    ticket = await getTicket(ticketId, { database });
  } catch (err) {
    if (!(err instanceof StorageError)) throw err;
    return { state: TICKET_STATE.UNAVAILABLE, ticketId, error: err.code, reason: err.message };
  }
  if (!ticket) return { state: TICKET_STATE.UNAVAILABLE, ticketId, reason: "El boleto no existe en la wallet" };

  const view = describeTicket(ticket);
  const problem = await signatureProblem(ticket, database);
  if (problem) return { state: TICKET_STATE.INVALID, ticketId, view, reason: problem };
  return { state: TICKET_STATE.VALID, ticketId, view, ticket };
}
