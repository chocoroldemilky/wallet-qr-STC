# Contrato de API — Módulo 4 hacia Módulo 5 (Wallet)
**Responsable:** Paloma Herrera Cid

## Endpoint de Recepción
* **Método:** `GET`
* **Ruta:** `/api/v1/wallet/tickets`
* **Autenticación requerida:** Header `Authorization: Bearer <JWT>` emitido por el Módulo 1.

##  Estructura del Payload JSON (Boleto Oficial de Prueba)
```json
{
  "ticketId": "BOL-001",
  "event": "Concierto de prueba",
  "date": "10/11/2026",
  "seat": "A12",
  "titular": "Usuario de prueba",
  "status": "ACTIVO",
  "skSession": "SK_SESSION_TEST_9988776654321",
  "signatureECDSA": "MEYCIQDx...mock_ecdsa_signature...=="
}