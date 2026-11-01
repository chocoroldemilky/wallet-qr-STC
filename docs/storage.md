# Almacenamiento local (storage.js)

Guarda los boletos en IndexedDB (con Dexie) cifrados con AES-GCM.

## Uso
Requiere `<script type="module">` y abrir la página con un servidor local.

```js
import { saveTickets, listTickets, getTicket, updateTicketStatus, deleteTicket } from "./storage.js";

await saveTickets(boletos, { syncedAt: Date.now() }); // boletos recibidos del Módulo 4
const lista = await listTickets();                    // [{ ticketId, status, ... }] sin descifrar
const boleto = await getTicket("BOL-001");            // boleto completo o null
await updateTicketStatus("BOL-001", "USADO");
await deleteTicket("BOL-001");
```

## Funciones
| Función | Regresa |
|---|---|
| `saveTicket(boleto)` | `{ ticketId, status }` |
| `saveTickets(boletos)` | cantidad guardada (todos o ninguno) |
| `getTicket(id)` | boleto descifrado o `null` |
| `listTickets({ status, decrypt })` | lista de boletos |
| `updateTicketStatus(id, status)` | `true` / `false` |
| `deleteTicket(id)` | `true` / `false` |
| `openStorage()` | `true` si IndexedDB está disponible |

El boleto solo necesita `ticketId`. Si no trae `status`, se guarda como `ACTIVO`.
Estados: `ACTIVO`, `USADO`, `CANCELADO`, `PENDIENTE_SINCRO`.

## Qué se guarda
- Tabla `tickets`: `ticketId` y `status` en claro; el resto del boleto cifrado (`iv`, `ciphertext`).
- Tabla `keys`: la clave AES, no extraíble.

## Errores
Las funciones lanzan `StorageError` con un `code`:

| Código | Causa |
|---|---|
| `INVALID_INPUT` | Boleto sin `ticketId` o `status` inválido |
| `DB_UNAVAILABLE` | El navegador no permite usar IndexedDB |
| `QUOTA_EXCEEDED` | Sin espacio |
| `DECRYPT_FAILED` | Datos alterados o clave incorrecta |
| `CORRUPTED` | Registro dañado |
| `OPERATION_FAILED` | Otro error |

## Notas
- Si se borran los datos del sitio, se pierden los boletos y hay que volver a descargarlos.
- El `status` local no sustituye la validación del Módulo 6.
- Pendiente con `apiRest`: guardar con `saveTickets` en lugar de `sessionStorage`.

## Pruebas
`npm run test:storage` (ver `tests/storage/README.md`).
