# Pruebas de almacenamiento

## Objetivo
Verificar el guardado y la recuperación de boletos cifrados (`src/js/storage.js`).

## Pruebas
- Esquema de IndexedDB y clave AES local.
- Guardar, consultar, listar, actualizar y eliminar boletos.
- Que no queden datos sensibles en claro y que se detecten datos alterados.
- Códigos de error de `StorageError`.

## Ejecución
```bash
npm install --ignore-scripts
npm run test:storage
```
En Node se usa `fake-indexeddb`. Para probar con IndexedDB real, levantar un servidor
(`python -m http.server 5500`) y abrir `http://127.0.0.1:5500/tests/storage/navegador.html`.

## Estado
55/55 pruebas correctas en Node y 13/13 en el navegador (Edge).
