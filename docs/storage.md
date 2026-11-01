# Almacenamiento local cifrado (`src/js/storage.js`)

Responsable: Francisco Omar Gutiérrez Silva — Lógica y persistencia (Módulo 5)

Guarda los boletos de la wallet en el navegador (IndexedDB, mediante Dexie) cifrados con
AES-GCM, para poder consultarlos sin conexión. Usa las funciones de `src/js/cripto.js`.

---

## 1. Requisitos para usarlo

1. **Cargar los scripts como módulos.** En `index.html`:
   ```html
   <script type="module" src="src/js/app.js"></script>
   ```
   Sin `type="module"` el navegador marca error en `import`.
2. **Abrir la página con un servidor local**, no con doble clic (`file://`). Los módulos,
   IndexedDB y Web Crypto lo necesitan. Opciones:
   ```bash
   python -m http.server 5500 --bind 127.0.0.1   # luego abrir http://127.0.0.1:5500
   ```
   o la extensión Live Server de VS Code.
3. **Dexie ya viene incluido** en `src/js/vendor/dexie.mjs` (copia local, funciona sin internet).
   No hay que instalar nada para usar el módulo en el navegador.

## 2. Inicio rápido

```js
import {
  openStorage, saveTickets, listTickets, getTicket,
  updateTicketStatus, deleteTicket, TICKET_STATUS, StorageError, STORAGE_ERR,
} from "./storage.js";

// Al iniciar la app: comprobar que el navegador permite guardar datos
await openStorage();

// Al recibir los boletos del Módulo 4 (o del mock de apiRest)
const tickets = await MockModulo4API.fetchUserTickets();
await saveTickets(tickets, { syncedAt: Date.now() });

// Vista "Mis boletos": no descifra, es rápido
const lista = await listTickets();             // [{ ticketId, status, updatedAt, last_synced_at }]
const activos = await listTickets({ status: TICKET_STATUS.ACTIVO });

// Vista de detalle / generación del QR: boleto completo descifrado
const boleto = await getTicket("BOL-001");     // objeto completo, o null si no existe
// boleto.skSession -> clave para el HMAC del QR (ver cripto.js)

// Cambios de estado y eliminación
await updateTicketStatus("BOL-001", TICKET_STATUS.USADO);
await deleteTicket("BOL-001");
```

## 3. Qué se guarda

Base: `walletDB` (versión 1 del esquema).

### Tabla `tickets` — un registro por boleto

| Campo | Cifrado | Descripción |
|---|---|---|
| `ticketId` | No | Clave primaria. Identificador del boleto. |
| `status` | No | Índice. Uno de `ACTIVO`, `USADO`, `CANCELADO`, `PENDIENTE_SINCRO`. |
| `iv` | — | Vector de inicialización de AES-GCM (base64url). Nuevo en cada cifrado. |
| `ciphertext` | **Sí** | El boleto completo cifrado: evento, fecha, asiento, titular, `skSession`, firma, etc. |
| `updatedAt` | No | Índice. Momento de la última escritura local (ms desde 1970). |
| `last_synced_at` | No | Momento de la última sincronización con el servidor (ms) o `null`. |

### Tabla `keys` — material criptográfico local

| Campo | Descripción |
|---|---|
| `id` | Clave primaria. La clave de cifrado usa `"storage-aes"`. |
| `key` | `CryptoKey` AES-GCM de 256 bits, **no extraíble**. |
| `createdAt` | Momento de creación (ms). |

## 4. Funciones

Todas son asíncronas (regresan una promesa) y aceptan como último parámetro un objeto de
opciones con `database` (por defecto la base de la app). `database` solo se usa en pruebas.

| Función | Regresa | Errores posibles |
|---|---|---|
| `openStorage()` | `true` | `DB_UNAVAILABLE` |
| `saveTicket(ticket, { syncedAt })` | `{ ticketId, status }` | `INVALID_INPUT`, `QUOTA_EXCEEDED`, `DB_UNAVAILABLE`, `CORRUPTED`, `OPERATION_FAILED` |
| `saveTickets(tickets, { syncedAt })` | número de boletos guardados | igual que `saveTicket` |
| `getTicket(ticketId)` | boleto completo, o `null` si no existe | `INVALID_INPUT`, `DECRYPT_FAILED`, `CORRUPTED`, `DB_UNAVAILABLE`, `OPERATION_FAILED` |
| `listTickets({ status, decrypt })` | arreglo de boletos | `INVALID_INPUT`, `DB_UNAVAILABLE`, `CORRUPTED`, `OPERATION_FAILED` |
| `updateTicketStatus(ticketId, status)` | `true` si existía, `false` si no | `INVALID_INPUT`, `DB_UNAVAILABLE`, `OPERATION_FAILED` |
| `deleteTicket(ticketId)` | `true` si existía, `false` si no | `INVALID_INPUT`, `DB_UNAVAILABLE`, `OPERATION_FAILED` |
| `getOrCreateStorageKey()` | `CryptoKey` | `CORRUPTED`, `DB_UNAVAILABLE`, `OPERATION_FAILED` |

Detalles:

- **`saveTicket`** cifra el objeto completo y lo guarda. Si ya existe un boleto con ese
  `ticketId`, lo reemplaza. Si el boleto no trae `status`, se guarda como `ACTIVO`.
- **`saveTickets`** guarda varios en una sola operación: **se guardan todos o ninguno**.
  Si un boleto es inválido, no se guarda nada.
- **`getTicket`** regresa `null` si el boleto no existe (no es un error).
- **`listTickets()`** sin opciones **no descifra**: regresa solo
  `{ ticketId, status, updatedAt, last_synced_at }`. Con `{ decrypt: true }` regresa los
  boletos completos; si alguno está dañado, en su lugar viene
  `{ ticketId, status, error: "<código>" }` y los demás llegan normalmente.
- **`updateTicketStatus`** cambia el estado sin volver a cifrar. Al leer, manda el `status`
  guardado en claro.
- **`getOrCreateStorageKey`** la usan internamente las demás funciones; normalmente no hace
  falta llamarla.

Constantes exportadas: `DB_NAME`, `TICKET_STATUS`, `STORAGE_ERR`, `STORAGE_KEY_ID`.
También `createDB(nombre)` (para pruebas) y `db` (instancia de la app).

## 5. Errores

Todas las funciones fallan con `StorageError`:

| Propiedad | Contenido |
|---|---|
| `code` | Uno de `STORAGE_ERR` (tabla siguiente). |
| `message` | Descripción en español. **Nunca** incluye datos del boleto ni claves. |
| `ticketId` | Boleto afectado, cuando aplica (no es secreto: se guarda en claro). |
| `cause` | Error original de Dexie o Web Crypto. Solo para depurar; no mostrar al usuario. |

| Código | Cuándo ocurre | Mensaje sugerido para el usuario |
|---|---|---|
| `INVALID_INPUT` | Boleto sin `ticketId`, `status` no permitido, id vacío. | Error de programación: corregir el código que llama. |
| `DB_UNAVAILABLE` | El navegador no tiene IndexedDB, la bloquea (algunos modos privados) o no se pudo abrir. | "Tu navegador no permite guardar boletos en este dispositivo." |
| `QUOTA_EXCEEDED` | No hay espacio de almacenamiento. | "No hay espacio suficiente. Libera espacio e inténtalo de nuevo." |
| `DECRYPT_FAILED` | Clave incorrecta o datos cifrados alterados. | "No se pudo abrir el boleto. Vuelve a descargarlo." |
| `CORRUPTED` | Registro incompleto, contenido cambiado entre boletos o clave local inválida. | "No se pudo abrir el boleto. Vuelve a descargarlo." |
| `OPERATION_FAILED` | Cualquier otro fallo. | "Ocurrió un error. Inténtalo de nuevo." |

Ejemplo:

```js
try {
  const boleto = await getTicket("BOL-001");
  if (!boleto) mostrarMensaje("No tienes ese boleto guardado.");
} catch (e) {
  if (!(e instanceof StorageError)) throw e;
  switch (e.code) {
    case STORAGE_ERR.DECRYPT_FAILED:
    case STORAGE_ERR.CORRUPTED:
      mostrarMensaje("No se pudo abrir el boleto. Vuelve a descargarlo.");
      break;
    case STORAGE_ERR.DB_UNAVAILABLE:
      mostrarMensaje("Tu navegador no permite guardar boletos en este dispositivo.");
      break;
    default:
      mostrarMensaje("Ocurrió un error. Inténtalo de nuevo.");
  }
}
```

## 6. Seguridad y manejo de claves

**Qué se protege**

- Todo el contenido del boleto (incluidos `skSession` y la firma ECDSA) se cifra con
  AES-GCM de 256 bits. En claro solo quedan `ticketId` y `status`, necesarios para buscar
  y filtrar.
- Cada cifrado usa un IV aleatorio nuevo.
- AES-GCM detecta cualquier modificación del contenido cifrado (`DECRYPT_FAILED`).
- Al descifrar se comprueba que el `ticketId` interno coincide con el del registro, para
  detectar contenido cifrado copiado de otro boleto (`CORRUPTED`).

**La clave de cifrado**

- Se genera una sola vez por navegador con `generateAESKey(false)` de `cripto.js` y se
  guarda en la tabla `keys` como `CryptoKey` **no extraíble**: el código puede usarla para
  cifrar y descifrar, pero no puede leer ni exportar sus bytes.
- Si hay varias pestañas abiertas, todas terminan usando la misma clave.
- Es distinta de `skSession` (clave HMAC del QR). `cripto.js` rechaza usar una en lugar de la otra.

**Limitaciones (importante)**

- La clave no extraíble evita que se lea, pero un script malicioso que se ejecute dentro de
  la misma página podría **usarla** para descifrar. El cifrado local protege contra la
  lectura directa de IndexedDB, no contra código malicioso en la app.
- Si el usuario borra los datos del sitio, se pierden la clave y los boletos. Hay que
  volver a descargarlos del servidor (Módulo 4).
- El `status` local es informativo y se puede modificar en el navegador. **La autorización
  final de acceso la decide el validador/servidor**, no este módulo.
- La clave todavía no está ligada a la sesión del usuario (Módulo 1). Queda pendiente
  definir esa estrategia con el equipo.

## 7. Formato de boleto e integración con `apiRest`

El formato definitivo aún no está acordado, así que el módulo **no impone una estructura**:
guarda el objeto tal como llega. Solo exige `ticketId` (texto no vacío) y, si viene,
`status` válido. Funciona con los dos formatos actuales de la rama `apiRest`:

```js
// api-mock.js: campos sueltos, con status
{ ticketId: "BOL-001", event: "...", date: "...", seat: "A12", titular: "...",
  skSession: "...", signatureECDSA: "...", status: "ACTIVO" }

// docs/api.md (contrato provisional): eventDetails, sin status -> se guarda como ACTIVO
{ ticketId: "BOL-001", eventDetails: { name, date, seat, holder },
  skSession: "...", signatureECDSA: "...", issuerPublicKey: "..." }
```

**Para la integración:** el mock guarda hoy el boleto en `sessionStorage` en texto plano,
incluido `skSession`. Al integrar, ese paso debe sustituirse por `saveTickets(...)` para
que el boleto quede cifrado, y no dejar copias en `sessionStorage` ni `localStorage`.

**Recomendación:** verificar la firma ECDSA (`verifyTicket` de `cripto.js`) **antes** de
guardar el boleto, y no guardar los que tengan firma inválida.

## 8. Cambios futuros al esquema

Si se decide dejar más campos en claro (por ejemplo nombre del evento y fecha, para la
vista de lista), **no modificar** `db.version(1)`: los navegadores que ya tienen la base la
conservarían con el esquema viejo. Agregar una versión nueva en `createDB`:

```js
db.version(1).stores({ tickets: "ticketId, status, updatedAt", keys: "id" });
db.version(2).stores({ tickets: "ticketId, status, updatedAt, eventDate" })
  .upgrade(async (tx) => { /* llenar eventDate en los registros existentes */ });
```

y ajustar `buildRecord` y `listTickets` para incluir esos campos.

## 9. Pruebas

```bash
npm install --ignore-scripts   # solo la primera vez
npm run test:storage           # 55 pruebas en Node (IndexedDB simulada con fake-indexeddb)
npm test                       # cripto + almacenamiento
```

Prueba manual con la IndexedDB real del navegador: levantar el servidor local (sección 1)
y abrir `http://127.0.0.1:5500/tests/storage/navegador.html`. Usa bases aparte
(`walletDB-prueba-…`) y no toca la base de la app. Detalle en `tests/storage/README.md`.

## 10. Dependencias

| Dependencia | Uso | Notas |
|---|---|---|
| `src/js/cripto.js` | `generateAESKey`, `encryptTicket`, `decryptTicket`, `CryptoError` | Responsable: Elizabeth Flores Jiménez. |
| Dexie 4.4.7 | Acceso a IndexedDB | Copia local en `src/js/vendor/dexie.mjs` con su licencia (Apache 2.0). Si se actualiza con npm, volver a copiar `dist/dexie.mjs`, `LICENSE` y `NOTICE`. |
| fake-indexeddb 6.2.7 | Solo pruebas | Dependencia de desarrollo; no se usa en el navegador. |
