/*
OBJETIVO:
Centralizar las operaciones criptograficas de la aplicacion.

RESPONSABILIDADES:
- Calcular HMAC-SHA256 para el QR dinamico.
- Cifrar y descifrar datos mediante AES-GCM.
- Verificar la firma digital de los boletos mediante la clave publica y el algoritmo definidos por el sistema.
- Gestionar los errores de las operaciones criptograficas (CryptoError con codigo).
- Utilizar Web Crypto API.

CONSIDERACIONES DE SEGURIDAD:
- No exponer claves secretas en la interfaz ni en los registros (claves no extraibles; los errores nunca incluyen claves ni datos).
- No confundir la clave HMAC de sesion (SK_session) con la clave de cifrado local (AES). Son tipos distintos y
  cada funcion rechaza la clave que no le corresponde.
- El HMAC NO sustituye la firma digital del boleto: el HMAC solo prueba que el QR lo genero quien tiene SK_session;
  la autenticidad del boleto la prueba unicamente ECDSA (verifyTicket).
- PENDIENTE de acordar con los modulos responsables: formato de claves y firmas (SIGNATURE_CONFIG), formato del
  boleto y del contenido del QR.

Responsable: Elizabeth Flores Jimenez (Modulo 5)
*/

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const QR_WINDOW_MS = 15000; // el QR cambia cada 15 s

// Algoritmo de firma definido por el sistema. Cambiar aqui cuando el Modulo 4 lo confirme.
export const SIGNATURE_CONFIG = {
  namedCurve: "P-256", // curva de la clave
  hash: "SHA-256",
  // Web Crypto firma/verifica en formato P1363 (r||s). Si el Modulo 4 usa DER, convertir antes de verificar.
  format: "P1363",
};

// Error unico de este modulo. El mensaje nunca incluye claves ni datos del boleto.
export const ERR = {
  INVALID_KEY: "INVALID_KEY",         // tipo/uso de clave incorrecto
  DECRYPT_FAILED: "DECRYPT_FAILED",   // clave incorrecta o datos alterados
  ENCRYPT_FAILED: "ENCRYPT_FAILED",
  BAD_FORMAT: "BAD_FORMAT",           // entrada malformada
  OPERATION_FAILED: "OPERATION_FAILED",
};
export class CryptoError extends Error {
  constructor(code, message) { super(message); this.name = "CryptoError"; this.code = code; }
}
function assertKey(key, algName, usage) {
  if (!key || key.algorithm?.name !== algName || !key.usages?.includes(usage)) {
    throw new CryptoError(ERR.INVALID_KEY, `Se requiere una clave ${algName} con uso '${usage}'`);
  }
}

// ---------- Utilidades ----------
export function toB64u(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64u(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

// JSON canónico (claves ordenadas): firmante y verificador deben firmar los mismos bytes.
export function canonicalize(obj) {
  if (Array.isArray(obj)) return "[" + obj.map(canonicalize).join(",") + "]";
  if (obj && typeof obj === "object") {
    return "{" + Object.keys(obj).sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
  }
  return JSON.stringify(obj);
}

// ---------- ECDSA P-256 / SHA-256 ----------
export async function generateECDSAKeyPair() {
  return subtle.generateKey({ name: "ECDSA", namedCurve: SIGNATURE_CONFIG.namedCurve }, true, ["sign", "verify"]);
}

// Solo para el emisor de PRUEBA (simula al Módulo 4). La wallet NUNCA tiene la clave privada.
export async function signTicket(ticket, privateKey) {
  const sig = await subtle.sign(
    { name: "ECDSA", hash: SIGNATURE_CONFIG.hash }, privateKey, enc.encode(canonicalize(ticket)));
  return toB64u(sig);
}

// true/false = firma valida/invalida. Lanza CryptoError solo si la clave no sirve para verificar.
export async function verifyTicket(ticket, signatureB64u, publicKey) {
  assertKey(publicKey, "ECDSA", "verify");
  try {
    return await subtle.verify(
      { name: "ECDSA", hash: SIGNATURE_CONFIG.hash }, publicKey,
      fromB64u(signatureB64u), enc.encode(canonicalize(ticket)));
  } catch {
    return false; // firma malformada => inválida
  }
}

export const exportPublicKeyJwk = (k) => subtle.exportKey("jwk", k);
export const importPublicKeyJwk = (jwk) =>
  subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: SIGNATURE_CONFIG.namedCurve }, true, ["verify"]);

// ---------- AES-GCM 256 ----------
// extractable=false: el JS de la página no puede leer los bytes de la clave.
// Un CryptoKey no extraíble sí se puede guardar en IndexedDB.
export function generateAESKey(extractable = false) {
  return subtle.generateKey({ name: "AES-GCM", length: 256 }, extractable, ["encrypt", "decrypt"]);
}

export async function encryptTicket(ticketObj, aesKey) {
  assertKey(aesKey, "AES-GCM", "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12)); // IV nuevo por cada cifrado
  let ct;
  try {
    ct = await subtle.encrypt({ name: "AES-GCM", iv }, aesKey, enc.encode(JSON.stringify(ticketObj)));
  } catch { throw new CryptoError(ERR.ENCRYPT_FAILED, "No se pudo cifrar"); }
  return { iv: toB64u(iv), ciphertext: toB64u(ct) }; // ciphertext incluye el tag de 128 bits
}

// Lanza error si la clave es incorrecta o si el contenido fue alterado.
export async function decryptTicket(record, aesKey) {
  assertKey(aesKey, "AES-GCM", "decrypt");
  let bytes;
  try {
    bytes = await subtle.decrypt(
      { name: "AES-GCM", iv: fromB64u(record.iv) }, aesKey, fromB64u(record.ciphertext));
  } catch { // no se distingue clave incorrecta de datos alterados (a proposito)
    throw new CryptoError(ERR.DECRYPT_FAILED, "No se pudo descifrar: clave incorrecta o datos alterados");
  }
  try { return JSON.parse(dec.decode(bytes)); }
  catch { throw new CryptoError(ERR.BAD_FORMAT, "El contenido descifrado no es un boleto valido"); }
}

// ---------- HMAC-SHA256 (QR dinámico) ----------
export const importSessionKey = (rawBytes) =>
  subtle.importKey("raw", rawBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export const currentWindow = (now = Date.now()) => Math.floor(now / QR_WINDOW_MS);

const qrMessage = (ticketId, win) => enc.encode(`${ticketId}|${win}`);

export async function hmacSHA256(key, message) {
  assertKey(key, "HMAC", "sign");
  return toB64u(await subtle.sign("HMAC", key, enc.encode(message)));
}

// Contenido del QR: ticketId.ventana.mac  (formato provisional)
export async function generateQRPayload(ticketId, skSession, now = Date.now()) {
  assertKey(skSession, "HMAC", "sign");
  const win = currentWindow(now);
  const mac = toB64u(await subtle.sign("HMAC", skSession, qrMessage(ticketId, win)));
  return `${ticketId}.${win}.${mac}`;
}

// Verificador de prueba. tolerance = ventanas aceptadas hacia atrás/adelante (desfase de reloj).
export async function verifyQRPayload(payload, skSession, now = Date.now(), tolerance = 1) {
  assertKey(skSession, "HMAC", "verify");
  if (typeof payload !== "string") return { valid: false, reason: "formato inválido" };
  const parts = payload.split(".");
  if (parts.length !== 3) return { valid: false, reason: "formato inválido" };
  const [ticketId, winStr, mac] = parts;
  const win = Number(winStr);
  if (!Number.isInteger(win)) return { valid: false, reason: "ventana inválida" };
  if (Math.abs(currentWindow(now) - win) > tolerance) return { valid: false, reason: "QR expirado" };
  let ok = false;
  try {
    // subtle.verify compara en tiempo constante
    ok = await subtle.verify("HMAC", skSession, fromB64u(mac), qrMessage(ticketId, win));
  } catch { /* mac malformado */ }
  return ok ? { valid: true, ticketId } : { valid: false, reason: "HMAC inválido" };
}