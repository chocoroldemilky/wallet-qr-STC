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