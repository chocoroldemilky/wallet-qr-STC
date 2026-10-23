# Módulo 5: App Móvil / Wallet del Usuario y QR Dinámico Anticopia

## Descripción del proyecto

Desarrollo de una aplicación cliente tipo wallet digital, diseñada para dispositivos móviles, que permite al usuario almacenar y consultar sus boletos comprados de forma segura, visualizar boletos interactivos y generar códigos QR dinámicos para la validación de acceso a eventos.

La aplicación contempla mecanismos criptográficos para proteger la información almacenada localmente, generar códigos QR temporales mediante HMAC-SHA256 y verificar offline la autenticidad de los boletos mediante firmas digitales.

## Objetivo

Desarrollar un prototipo de wallet digital que permita administrar y presentar boletos electrónicos de manera segura, incorporando un QR dinámico con rotación cada 15 segundos, almacenamiento local cifrado y capacidades básicas de validación offline.

## Alcance y funcionalidades

### 1. Wallet digital

- Visualización de los boletos disponibles del usuario.
- Presentación de información del evento, fecha, zona y asiento, según los datos proporcionados.
- Renderizado de boletos interactivos mediante una interfaz adaptable a dispositivos móviles.
- Manejo de estados y errores relacionados con la consulta o visualización de boletos.

### 2. Generación de QR dinámico

El código QR se generará mediante HMAC-SHA256, utilizando la clave de sesión y los datos del boleto junto con un valor temporal.

**Fórmula criptográfica especificada:**

`HMAC-SHA256(SK_session, TicketID || Timestamp_TOTP)`

- Actualización del QR cada 15 segundos.
- Contador visual del tiempo restante para la siguiente actualización.
- Uso consistente de los datos y del formato temporal entre la aplicación y el módulo validador.
- Manejo de errores cuando no se disponga de los datos o claves necesarios para generar el código.

La generación y validación del QR deberán seguir un protocolo acordado con el equipo responsable del Módulo 6.

### 3. Almacenamiento local cifrado

- Almacenamiento local de los datos necesarios para consultar los boletos.
- Cifrado de la información mediante AES-GCM.
- Protección de las claves y del material criptográfico de acuerdo con las capacidades de la plataforma.
- Manejo de errores de cifrado, descifrado y recuperación de datos.

Las claves privadas y las claves de sesión deberán contar con mecanismos de protección adecuados. El almacenamiento cifrado no sustituye la protección de las claves utilizadas para acceder a la información.

### 4. Validación básica offline

- Verificación de la firma digital del boleto mediante una clave pública confiable.
- Comprobación de la integridad y autenticidad de los datos firmados.
- Manejo de boletos inválidos, datos alterados o firmas incorrectas.
- Disponibilidad de los datos y claves públicas necesarios para realizar la verificación sin conexión.

La validación offline de una firma no garantiza por sí sola que un boleto no haya sido utilizado anteriormente. La prevención de reutilización y la autorización final de acceso dependerán de las reglas y capacidades del sistema validador.

### 5. Interfaz y medidas disuasorias anticaptura

- Diseño responsivo para dispositivos móviles.
- Renderizado interactivo del boleto y del código QR.
- Contador visual para la actualización del código.
- Animaciones y elementos visuales destinados a dificultar la reutilización de capturas de pantalla.

Las animaciones son medidas disuasorias y no garantizan la prevención de capturas, grabaciones o copias del código QR.

## Tecnologías propuestas

| Tecnología | Propósito |
|---|---|
| HTML5 | Estructura de la interfaz. |
| CSS3 | Diseño responsivo, animaciones y presentación visual. |
| JavaScript (ES6+) | Lógica de la aplicación y actualización de la interfaz. |
| Web Crypto API | Operaciones criptográficas compatibles, incluyendo HMAC-SHA256, AES-GCM y verificación de firmas. |
| IndexedDB | Persistencia local de datos cifrados. |
| qrcode.js | Generación visual de códigos QR. |
| Git y GitHub | Control de versiones y colaboración. |
| GitHub Actions | Automatización de comprobaciones y pruebas. |
| Node.js / npm | Herramientas de desarrollo y ejecución de pruebas, según la configuración definitiva. |

Las tecnologías anteriores constituyen una propuesta inicial. La selección final dependerá de los requisitos de ejecución, compatibilidad y despliegue que acuerde el equipo.

## Integración con otros módulos

El Módulo 5 requiere coordinación con los siguientes componentes del proyecto:

- **Módulo 1 — Autenticación / PKI:** integración con los mecanismos de autenticación y confianza de claves, según el contrato definido.
- **Módulo 4 — Ticket Engine:** recepción de los boletos comprados, sus datos y las firmas digitales correspondientes.
- **Módulo 6 — Validator App:** compatibilidad del formato del QR dinámico, la clave de sesión, el intervalo temporal y las reglas de validación.

Antes de integrar los módulos, deberán definirse los formatos de los datos, el manejo y distribución de claves, la tolerancia de reloj, el tratamiento de códigos vencidos y las reglas para prevenir la reutilización de boletos.

## Estructura del repositorio

```text
wallet-qr-dinamico/
├── index.html
├── src/
│   ├── css/
│   │   └── styles.css
│   ├── js/
│   │   ├── app.js
│   │   ├── wallet.js
│   │   ├── qr-dynamic.js
│   │   ├── crypto.js
│   │   └── storage.js
│   └── assets/
├── tests/
│   ├── functional/
│   │   └── README.md
│   ├── cryptographic/
│   │   └── README.md
│   └── integration/
│       └── README.md
├── docs/
│   ├── architecture.md
│   ├── api-contracts.md
│   └── test-plan.md
├── .github/
│   └── workflows/
│       └── ci.yml
├── .gitignore
├── README.md
└── package.json
```

La estructura representa la organización inicial propuesta para el repositorio. Los archivos y las herramientas de pruebas se completarán conforme avance la implementación.

## Calidad y estrategia de pruebas

Se contempla desarrollar pruebas para comprobar los siguientes aspectos:

- **Pruebas funcionales:** visualización de boletos, navegación, contador, rotación del QR y manejo de errores.
- **Pruebas criptográficas:** generación y verificación de HMAC-SHA256 con vectores de prueba conocidos; cifrado y descifrado AES-GCM; detección de modificaciones en los datos; y verificación de firmas digitales válidas e inválidas.
- **Pruebas de almacenamiento:** persistencia, recuperación, descifrado y manejo de datos corruptos o inaccesibles.
- **Pruebas de integración:** compatibilidad de los datos y mecanismos criptográficos con los Módulos 1, 4 y 6.
- **Pruebas de seguridad:** revisión del tratamiento de claves, ausencia de secretos en el repositorio y protección de información sensible.
- **Automatización:** ejecución de las comprobaciones configuradas mediante GitHub Actions.

Los resultados de las pruebas deberán documentarse. Las pruebas de integración definitivas dependerán de la disponibilidad de los contratos y servicios de los otros módulos.

## Seguridad

El desarrollo deberá considerar las siguientes medidas:

- No incluir contraseñas, claves privadas ni claves de sesión reales en el repositorio.
- Evitar el almacenamiento de información sensible en texto plano.
- Proteger adecuadamente las claves utilizadas para cifrar y descifrar los datos locales.
- Verificar las firmas digitales con claves públicas confiables.
- Acordar el formato de los datos de entrada para evitar discrepancias entre la generación y validación del QR.
- Utilizar HTTPS cuando la aplicación se comunique con servicios remotos.
- Considerar los riesgos de capturas, copias, reutilización y exposición de códigos QR.
- No presentar la validación offline de una firma como garantía de que el boleto no ha sido utilizado previamente.

## Estado del proyecto

**Estado:** Prototipo en desarrollo.

El equipo responsable del Módulo 5 tendrá a su cargo el desarrollo de la wallet digital, el renderizado de los boletos, la generación del QR dinámico, el almacenamiento local cifrado, la validación básica offline y las pruebas correspondientes, además de la coordinación técnica necesaria para integrarse con los demás módulos.

