/*
OBJETIVO:
Gestionar la generacion y visualizacion del QR dinamico.

RESPONSABILIDADES PREVISTAS:
- Calcular el periodo temporal de referencia.
- Solicitar el calculo del HMAC-SHA256 al modulo criptografico.
- Generar el contenido QR conforme al contrato acordado con el Modulo 6.
- Actualizar el QR en periodos de 15 segundos.
- Mostrar el contador de tiempo restante.
- Gestionar errores de generacion y cambios de periodo.

DEPENDENCIAS:
crypto.js y el Modulo 6.
*/

let qrcodeInstance = null;
let timerInterval = null;

function switchView(viewId) {
  const views = ['view-login', 'view-list', 'view-detail'];
  views.forEach(id => {
    document.getElementById(id).style.display = (id === viewId) ? 'block' : 'none';
  });
  
  if (viewId !== 'view-detail' && timerInterval) {
    clearInterval(timerInterval);
  }
}

function initQR() {
  if (!qrcodeInstance) {
    qrcodeInstance = new QRCode(document.getElementById("qrcode"), { 
      width: 160, 
      height: 160 
    });
  }
  updateDynamicQR();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateDynamicQR, 1000);
}

function updateDynamicQR() {
  const now = Math.floor(Date.now() / 1000);
  const secondsLeft = 15 - (now % 15);
  const timeBucket = Math.floor(now / 15);

  if (document.getElementById('view-detail').style.display === 'block') {
    // Estructura incorporando el TicketID BOL-001 y datos de la sección 11.3
    const payload = `TICKET:BOL-001|EVENT:Concierto_de_prueba|DATE:10/11/2026|SEAT:A12|USER:Usuario_de_prueba|BUCKET:${timeBucket}`;
    qrcodeInstance.makeCode(payload);

    document.getElementById('timer-sec').textContent = secondsLeft;
    document.getElementById('progress-fill').style.width = `${(secondsLeft / 15) * 100}%`;
  }
}