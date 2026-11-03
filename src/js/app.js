/*
OBJETIVO:
Coordinar el funcionamiento general de la aplicacion.

RESPONSABILIDADES:
- Inicializar la aplicacion (almacenamiento local cifrado y boletos de prueba).
- Gestionar la navegacion entre vistas.
- Coordinar la comunicacion entre los modulos JavaScript.
- Mostrar mensajes de error y estados de carga.
- Preparar la integracion con los servicios externos (Modulos 1, 4 y 6, pendientes).

DEPENDENCIAS:
wallet.js y qr-dinamico.js (que usan cripto.js y storage.js).
*/

import { TICKET_STATE, TICKET_STATUS, initWallet, loadTicket, loadTicketList } from "./wallet.js";
import { initQR, stopQR } from "./qr-dinamico.js";

const VIEWS = ["view-login", "view-list", "view-detail"];
const $ = (id) => document.getElementById(id);

// IndexedDB se abre (y se guardan los boletos de prueba si hace falta) mientras se muestra el login.
const ready = initWallet();
ready.catch((err) => console.error("No se pudo iniciar la wallet:", err?.code ?? err?.name));

// Cada cambio de vista invalida lo que la vista anterior seguia cargando.
let navigation = 0;

function switchView(viewId) {
  navigation++;
  for (const id of VIEWS) $(id).style.display = id === viewId ? "block" : "none";
  return navigation;
}

function setMessage(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle("error", isError);
  el.hidden = !text;
}

// Los errores de storage.js y cripto.js nunca incluyen datos del boleto ni claves.
function errorText(err) {
  if (err?.code) return `${err.message} (${err.code})`;
  return err?.message || "Error inesperado";
}

// ---------- Mis boletos ----------
async function showList() {
  stopQR();
  const nav = switchView("view-list");
  const msg = $("list-msg");
  $("ticket-list").replaceChildren();
  setMessage(msg, "Cargando boletos…");
  try {
    await ready;
    const tickets = await loadTicketList();
    if (nav !== navigation) return;
    setMessage(msg, tickets.length ? "" : "No hay boletos guardados en esta wallet.");
    $("ticket-list").replaceChildren(...tickets.map(renderTicket));
  } catch (err) {
    if (nav === navigation) setMessage(msg, `No se pudieron cargar los boletos: ${errorText(err)}`, true);
  }
}

// Llena la plantilla del front con un boleto descifrado.
function renderTicket(t) {
  const item = $("ticket-template").content.firstElementChild.cloneNode(true);
  const field = (name) => item.querySelector(`[data-field="${name}"]`);
  const button = item.querySelector("button");
  field("ticketId").textContent = t.ticketId;
  if (t.error) {
    item.classList.add("damaged");
    field("name").textContent = `Boleto ${t.ticketId}`;
    field("holder").parentElement.textContent = "⚠️ No se pudo descifrar este boleto";
    field("date").parentElement.textContent = `Código: ${t.error}`;
    field("seat").parentElement.remove();
    button.disabled = true;
    return item;
  }
  for (const name of ["name", "holder", "date", "seat"]) field(name).textContent = t[name];
  button.addEventListener("click", () => showDetail(t.ticketId));
  return item;
}

// ---------- Detalle y QR dinamico ----------
const BADGES = {
  pending: ["badge badge-pending", "Verificando firma…"],
  [TICKET_STATE.VALID]: ["badge", "✓ Boleto Verificado"],
  [TICKET_STATE.INVALID]: ["badge badge-error", "✗ Firma ECDSA no válida"],
  [TICKET_STATE.UNAVAILABLE]: ["badge badge-error", "✗ Boleto no disponible"],
};

const DETAIL_FIELDS = {
  "detail-name": "name", "detail-id": "ticketId", "detail-holder": "holder", "detail-date": "date", "detail-seat": "seat",
};

function setBadge(kind) {
  const [className, text] = BADGES[kind];
  $("detail-badge").className = className;
  $("detail-badge").textContent = text;
}

// Sin datos (cargando o boleto no disponible) se ocultan las lineas TicketID, Titular, Fecha y Asiento.
function showTicketInfo(view) {
  for (const [id, key] of Object.entries(DETAIL_FIELDS)) $(id).textContent = view?.[key] ?? "";
  for (const line of document.querySelectorAll("#view-detail .ticket-info")) line.hidden = !view;
}

function setQRVisible(visible) {
  $("qr-card").hidden = !visible;
  $("timer-container").hidden = !visible;
}

async function showDetail(ticketId) {
  const nav = switchView("view-detail");
  const msg = $("detail-msg");
  setBadge("pending");
  setQRVisible(false);
  setMessage(msg, "");
  showTicketInfo(null);

  let result;
  try {
    result = await loadTicket(ticketId);
  } catch (err) {
    result = { state: TICKET_STATE.UNAVAILABLE, reason: errorText(err) };
  }
  if (nav !== navigation) return; // el usuario ya salio del detalle

  setBadge(result.state);
  showTicketInfo(result.view);
  if (result.state !== TICKET_STATE.VALID) {
    const code = result.error ? ` (${result.error})` : "";
    setMessage(msg, `${result.reason}${code}. No se genera el QR.`, true);
    return;
  }
  // El status local es informativo; la validacion final la hace el Modulo 6.
  const { status } = result.view;
  if (status && status !== TICKET_STATUS.ACTIVO) setMessage(msg, `Estado local del boleto: ${status}`);

  const onQRError = (err) => {
    if (nav !== navigation) return;
    setQRVisible(false);
    setMessage(msg, `No se pudo generar el QR: ${errorText(err)}`, true);
  };
  try {
    await initQR(result.ticket, onQRError);
    if (nav === navigation) setQRVisible(true);
  } catch (err) {
    onQRError(err);
  }
}

$("btn-login").addEventListener("click", showList);
$("btn-back").addEventListener("click", showList);
