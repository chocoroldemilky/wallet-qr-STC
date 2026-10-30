# Propuesta de Contrato de API — Módulo 4 hacia Módulo 5 (Wallet)

## Endpoint de Recepción de Boletos
* **Método:** `GET` (o `POST` según sincronización)
* **URL:** `/api/v1/wallet/tickets`
* **Headers requeridos:**
  * `Authorization: Bearer <JWT_MODULO_1>` (Token de sesión emitido por el Módulo 1)

## Estructura de Respuesta JSON (Payload Provisional)
```json
{
  "status": "success",
  "data": {
    "tickets": [
      {
        "ticketId": "BOL-001",
        "eventDetails": {
          "name": "Concierto de prueba",
          "date": "10/11/2026",
          "seat": "A12",
          "holder": "Usuario de prueba"
        },
        "skSession": "A1B2C3D4E5F67890123456789ABCDEF0", 
        "signatureECDSA": "3045022100e79...f42",
        "issuerPublicKey": "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEP..."
      }
    ]
  }
}