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


let qrcode = null;

function goToView(viewId) {
    document.getElementById('view-login').style.display = 'none';
    document.getElementById('view-list').style.display = 'none';
    document.getElementById('view-detail').style.display = 'none';
    document.getElementById(viewId).style.display = 'block';
}

function goToDetail() {
    goToView('view-detail');
    if (!qrcode) {
        qrcode = new QRCode(document.getElementById("qrcode"), { width: 170, height: 170 });
    }
    updateQR();
}

function updateQR() {
    const now = Math.floor(Date.now() / 1000);
    const secondsLeft = 15 - (now % 15);
    const timeBucket = Math.floor(now / 15);

    if (qrcode && document.getElementById('view-detail').style.display === 'block') {
        qrcode.makeCode(`TCK-001|BUCKET-${timeBucket}|HMAC_SHA256_MOCK`);
        document.getElementById('timer-sec').textContent = secondsLeft;
        document.getElementById('progress-fill').style.width = `${(secondsLeft / 15) * 100}%`;
    }
}

setInterval(updateQR, 1000);