// Ejecutar: node test.mjs
import * as C from "../../src/js/cripto.js";
import { writeFileSync } from "node:fs";

const results = [];
async function test(name, expected, fn) {
  let got;
  try { got = await fn(); } catch { got = false; }
  const pass = got === expected;
  results.push({ pass, name, esperado: expected ? "válido" : "inválido" });
}

// --- Boleto de prueba (simula al Módulo 4) ---
const ticket = {
  ticketId: "BOL-001", evento: "Concierto de prueba", fecha: "10/11/2026",
  asiento: "A12", titular: "Usuario de prueba",
};
const issuer = await C.generateECDSAKeyPair();
const otherIssuer = await C.generateECDSAKeyPair();
const signature = await C.signTicket(ticket, issuer.privateKey);

// ---------- ECDSA ----------
await test("ECDSA: boleto original con firma correcta", true,
  () => C.verifyTicket(ticket, signature, issuer.publicKey));
await test("ECDSA: boleto alterado (asiento A12 -> A13)", false,
  () => C.verifyTicket({ ...ticket, asiento: "A13" }, signature, issuer.publicKey));
await test("ECDSA: firma de otra clave (emisor falso)", false,
  () => C.verifyTicket(ticket, signature, otherIssuer.publicKey));
await test("ECDSA: firma modificada", false, async () => {
  const bad = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  return C.verifyTicket(ticket, bad, issuer.publicKey);
});
await test("ECDSA: firma malformada", false,
  () => C.verifyTicket(ticket, "no-es-una-firma", issuer.publicKey));
await test("ECDSA: orden de campos distinto (canonicalización)", true,
  () => C.verifyTicket({ titular: ticket.titular, asiento: ticket.asiento, fecha: ticket.fecha,
    evento: ticket.evento, ticketId: ticket.ticketId }, signature, issuer.publicKey));

// ---------- AES-GCM ----------
const aesKey = await C.generateAESKey(false);
const wrongKey = await C.generateAESKey(false);
const stored = { ticket, signature };
const rec = await C.encryptTicket(stored, aesKey);

await test("AES-GCM: cifrar y descifrar devuelve el boleto original", true, async () =>
  JSON.stringify(await C.decryptTicket(rec, aesKey)) === JSON.stringify(stored));
await test("AES-GCM: el texto cifrado no contiene el boleto en claro", true, async () =>
  !atob(rec.ciphertext.replace(/-/g, "+").replace(/_/g, "/")).includes("BOL-001"));
await test("AES-GCM: descifrar con clave incorrecta", false, async () => {
  await C.decryptTicket(rec, wrongKey); return true; });
await test("AES-GCM: ciphertext alterado (falla el tag)", false, async () => {
  const bytes = C.fromB64u(rec.ciphertext); bytes[0] ^= 1;
  await C.decryptTicket({ ...rec, ciphertext: C.toB64u(bytes) }, aesKey); return true; });
await test("AES-GCM: IV alterado", false, async () => {
  const iv = C.fromB64u(rec.iv); iv[0] ^= 1;
  await C.decryptTicket({ ...rec, iv: C.toB64u(iv) }, aesKey); return true; });
await test("AES-GCM: IV distinto en cada cifrado", true, async () =>
  (await C.encryptTicket(stored, aesKey)).iv !== (await C.encryptTicket(stored, aesKey)).iv);
await test("AES-GCM: clave no extraíble (no se puede exportar)", false, async () => {
  await crypto.subtle.exportKey("raw", aesKey); return true; });

// ---------- HMAC-SHA256 ----------
const SK_TEST = crypto.getRandomValues(new Uint8Array(32)); // SK_session ficticia
const sk = await C.importSessionKey(SK_TEST);
const skOther = await C.importSessionKey(crypto.getRandomValues(new Uint8Array(32)));
const t0 = Date.UTC(2026, 9, 25, 12, 0, 0);
const qr = await C.generateQRPayload("BOL-001", sk, t0);

await test("HMAC: vector conocido RFC 4231 caso 2", true, async () => {
  const k = await C.importSessionKey(new TextEncoder().encode("Jefe"));
  const mac = C.fromB64u(await C.hmacSHA256(k, "what do ya want for nothing?"));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";
});
await test("HMAC: QR recién generado", true, async () => (await C.verifyQRPayload(qr, sk, t0 + 1000)).valid);
await test("HMAC: QR de la ventana anterior (tolerancia ±1)", true, async () =>
  (await C.verifyQRPayload(qr, sk, t0 + 16000)).valid);
await test("HMAC: QR expirado (más de 2 ventanas)", false, async () =>
  (await C.verifyQRPayload(qr, sk, t0 + 40000)).valid);
await test("HMAC: QR cambia cada 15 s", true, async () =>
  qr !== (await C.generateQRPayload("BOL-001", sk, t0 + 15000)));
await test("HMAC: QR estable dentro de la misma ventana", true, async () =>
  qr === (await C.generateQRPayload("BOL-001", sk, t0 + 5000)));
await test("HMAC: verificado con SK_session incorrecta", false, async () =>
  (await C.verifyQRPayload(qr, skOther, t0)).valid);
await test("HMAC: ticketId alterado en el QR", false, async () =>
  (await C.verifyQRPayload(qr.replace("BOL-001", "BOL-002"), sk, t0)).valid);
await test("HMAC: MAC alterado", false, async () => {
  const p = qr.split("."); p[2] = (p[2][0] === "A" ? "B" : "A") + p[2].slice(1);
  return (await C.verifyQRPayload(p.join("."), sk, t0)).valid; });
await test("HMAC: formato inválido", false, async () => (await C.verifyQRPayload("basura", sk, t0)).valid);

// ---------- Errores y separación de claves ----------
const codeOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.code ?? "RAW"; } };
await test("Errores: descifrar con clave incorrecta -> DECRYPT_FAILED", true, async () =>
  (await codeOf(() => C.decryptTicket(rec, wrongKey))) === C.ERR.DECRYPT_FAILED);
await test("Separación: clave HMAC usada para AES -> INVALID_KEY", true, async () =>
  (await codeOf(() => C.encryptTicket(stored, sk))) === C.ERR.INVALID_KEY);
await test("Separación: clave AES usada para el QR -> INVALID_KEY", true, async () =>
  (await codeOf(() => C.generateQRPayload("BOL-001", aesKey, t0))) === C.ERR.INVALID_KEY);
await test("Separación: clave AES usada para verificar firma -> INVALID_KEY", true, async () =>
  (await codeOf(() => C.verifyTicket(ticket, signature, aesKey))) === C.ERR.INVALID_KEY);
await test("Errores: el mensaje de error no filtra datos del boleto", true, async () => {
  try { await C.decryptTicket(rec, wrongKey); } catch (e) { return !e.message.includes("BOL-001"); } });

// ---------- Resultados ----------
let fails = 0;
for (const r of results) {
  if (!r.pass) fails++;
  console.log(`${r.pass ? "OK  " : "FALLO"} | caso ${r.esperado.padEnd(8)} | ${r.name}`);
}
console.log(`\n${results.length - fails}/${results.length} pruebas correctas`);

// Boleto firmado de prueba para compartir con Paloma / la wallet (SIN clave privada)
writeFileSync(new URL("./boleto-firmado-prueba.json", import.meta.url), JSON.stringify({
  ticket, signature,
  publicKeyJwk: await C.exportPublicKeyJwk(issuer.publicKey),
  sk_session_PRUEBA_b64u: C.toB64u(SK_TEST),
  aviso: "Claves SOLO de prueba. No usar como credenciales definitivas.",
}, null, 2));
process.exit(fails ? 1 : 0);
