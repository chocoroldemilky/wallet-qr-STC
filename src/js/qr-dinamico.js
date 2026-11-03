/*
OBJETIVO:
Gestionar la generacion y visualizacion del QR dinamico.

RESPONSABILIDADES:
- Calcular el periodo temporal de referencia (ventanas de 15 s de cripto.js).
- Solicitar el calculo del HMAC-SHA256 al modulo criptografico (generateQRPayload).
- Generar el contenido QR conforme al contrato acordado con el Modulo 6
  (formato provisional de cripto.js: ticketId.ventana.mac).
- Actualizar el QR en periodos de 15 segundos.
- Mostrar el contador de tiempo restante.
- Gestionar errores de generacion y cambios de periodo.

DEPENDENCIAS:
cripto.js, qrcode.js (variable global QRCode, cargada en index.html) y el Modulo 6.
*/

import { QR_WINDOW_MS, currentWindow, fromB64u, generateQRPayload, importSessionKey } from "./cripto.js";

const WINDOW_SECONDS = QR_WINDOW_MS / 1000;

let qrcodeInstance = null;
let timerInterval = null;
let active = null; // QR en pantalla: { ticketId, key, window }

// La SK_session viene dentro del boleto descifrado, en base64url (formato provisional, pendiente con los Modulos 4 y 6).
export async function importQRKey(ticket) {
  if (typeof ticket?.skSession !== "string" || ticket.skSession === "") {
    throw new Error("El boleto no trae la clave de sesión del QR");
  }
  return importSessionKey(fromB64u(ticket.skSession));
}

// Segundos para el siguiente QR (15..1) y fraccion de la barra de progreso.
export function timeLeft(now = Date.now()) {
  const seconds = Math.ceil((QR_WINDOW_MS - (now % QR_WINDOW_MS)) / 1000);
  return { seconds, fraction: seconds / WINDOW_SECONDS };
}

// Muestra el QR del boleto y lo renueva cada vez que cambia la ventana de 15 s.
// Los errores de la primera generacion se lanzan; los posteriores llegan a onError.
export async function initQR(ticket, onError) {
  stopQR();
  const session = { ticketId: ticket.ticketId, key: null, window: null };
  active = session;
  if (typeof QRCode === "undefined") {
    throw new Error("No se pudo cargar la librería qrcode.js (revisa la conexión)");
  }
  session.key = await importQRKey(ticket);
  if (active !== session) return; // se salio del detalle mientras se importaba la clave

  if (!qrcodeInstance) {
    qrcodeInstance = new QRCode(document.getElementById("qrcode"), {
      width: 160,
      height: 160
    });
  }
  await updateDynamicQR(session);
  if (active !== session) return;
  timerInterval = setInterval(() => {
    updateDynamicQR(session).catch((err) => {
      stopQR();
      onError?.(err);
    });
  }, 1000);
}

export function stopQR() {
  active = null;
  clearInterval(timerInterval);
  timerInterval = null;
}

async function updateDynamicQR(session) {
  const now = Date.now();
  const { seconds, fraction } = timeLeft(now);
  document.getElementById("timer-sec").textContent = seconds;
  document.getElementById("progress-fill").style.width = `${fraction * 100}%`;

  const win = currentWindow(now);
  if (session.window === win) return; // misma ventana: el QR no cambia
  session.window = win;
  const payload = await generateQRPayload(session.ticketId, session.key, now);
  if (active === session) qrcodeInstance.makeCode(payload);
}
