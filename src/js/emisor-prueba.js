/*
OBJETIVO:
Emisor de PRUEBA: simula al Modulo 4 (Ticket Engine) mientras no este integrado.

RESPONSABILIDADES:
- Firmar con ECDSA P-256 (cripto.js) los boletos de demostracion de la wallet.
- Generar una SK_session aleatoria de 32 bytes por boleto para el QR dinamico (base64url).

CONSIDERACIONES DE SEGURIDAD:
- La clave privada solo existe en memoria mientras se firma: no se guarda ni se exporta.
- La wallet solo recibe la clave publica (JWK) para verificar las firmas.
- Retirar este modulo cuando la wallet reciba los boletos firmados del Modulo 4.

DEPENDENCIAS:
cripto.js
*/

import { exportPublicKeyJwk, generateECDSAKeyPair, signTicket, toB64u } from "./cripto.js";

// Formato del contrato del Modulo 4 (docs/api.md de la rama apiRest). BOL-001 es el boleto oficial
// de prueba que muestran las pantallas del front; BOL-002 usa los datos de la primera version del front.
export const DEMO_TICKETS = [
  { ticketId: "BOL-001", event: "Concierto de prueba", date: "10/11/2026", seat: "A12", titular: "Usuario de prueba" },
  {
    ticketId: "BOL-002", event: "Auditorio Nacional", date: "15/11/2026",
    seat: "Zona A - Fila 3, Asiento 12", titular: "Usuario de prueba",
  },
];

// Regresa los boletos firmados y la clave publica del emisor.
export async function issueDemoTickets(data = DEMO_TICKETS) {
  const { privateKey, publicKey } = await generateECDSAKeyPair();
  const tickets = await Promise.all(data.map(async (ticket) => ({
    ...ticket,
    status: "ACTIVO",
    skSession: toB64u(crypto.getRandomValues(new Uint8Array(32))),
    signatureECDSA: await signTicket(ticket, privateKey),
  })));
  return { tickets, publicKeyJwk: await exportPublicKeyJwk(publicKey) };
}
