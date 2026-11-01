# Pruebas de almacenamiento

## Objetivo
Verificar la persistencia local cifrada de los boletos (`src/js/storage.js`):
esquema de IndexedDB, gestión de la clave AES, operaciones con boletos,
confidencialidad e integridad de los datos guardados y manejo de errores.

## Ejecución
```bash
npm install --ignore-scripts   # solo la primera vez
npm run test:storage           # solo almacenamiento
npm test                       # cripto + almacenamiento
```

IndexedDB no existe en Node, así que se simula con `fake-indexeddb`
(dependencia de desarrollo). Cada grupo de pruebas usa una base distinta.

## Grupos de pruebas
| Grupo | Qué comprueba |
|---|---|
| Esquema | Tablas `tickets` y `keys`, claves primarias e índices; `openStorage()`. |
| Clave AES | Clave AES-GCM no extraíble, reutilización, persistencia tras recargar, dos pestañas simultáneas, una clave por base. |
| Operaciones | `saveTicket`, `saveTickets` (todo o nada), `getTicket`, `listTickets` (con y sin descifrar, filtro por status), `updateTicketStatus`, `deleteTicket`; formatos de boleto del mock y del contrato provisional. |
| Seguridad | Sin datos sensibles en claro en IndexedDB, IV distinto por cifrado, detección de ciphertext o IV alterados y de contenido intercambiado entre boletos, mensajes de error sin datos del boleto. |
| Errores | Cada código de `StorageError`: `INVALID_INPUT`, `CORRUPTED`, `DECRYPT_FAILED`, `QUOTA_EXCEEDED`, `DB_UNAVAILABLE`, `OPERATION_FAILED` (los fallos del navegador se simulan). |

## Limitaciones
- `fake-indexeddb` simula IndexedDB en memoria; el comportamiento de cuota y
  bloqueo de un navegador real se simula reemplazando métodos de Dexie.
- Falta una prueba manual en navegador (Chrome/Firefox en móvil) cuando la
  interfaz cargue `storage.js`.

## Estado
55/55 pruebas correctas (31/10/2026).
