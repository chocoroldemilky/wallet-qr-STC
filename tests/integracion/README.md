# Pruebas de integración

## Objetivo
Comprobar la interoperabilidad de la wallet con los módulos externos.

## Integraciones previstas
- Módulo 1: autenticación y gestión de sesión.
- Módulo 4: recepción de boletos y firmas digitales.
- Módulo 6: formato y validación del QR dinámico.

## Estrategia
Utilizar datos simulados mientras los contratos o servicios
definitivos no estén disponibles.

## Pruebas automatizadas (`test.mjs`)
Recorren el flujo que usan las pantallas, sin interfaz:
- Inicio de la wallet con los boletos del emisor de prueba (`src/js/emisor-prueba.js`, simula al Módulo 4).
- Lista y detalle (`wallet.js`) con los datos descifrados de IndexedDB (`storage.js`, AES-GCM).
- Verificación de la firma ECDSA: boletos válidos, alterados, de otro emisor o sin firma.
- QR dinámico (`qr-dinamico.js` + `cripto.js`): formato, cambio cada 15 s y verificación HMAC con la SK_session.

```bash
npm install --ignore-scripts
npm run test:integracion
```

## Estado
Flujo interno de la wallet automatizado con datos de prueba.
Pendiente la integración real con los Módulos 1, 4 y 6.