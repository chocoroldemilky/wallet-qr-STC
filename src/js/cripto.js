/*
OBJETIVO:
Centralizar las operaciones criptograficas de la aplicacion.

RESPONSABILIDADES PREVISTAS:
- Calcular HMAC-SHA256 para el QR dinamico.
- Cifrar y descifrar datos mediante AES-GCM.
- Verificar la firma digital de los boletos mediante la clave publica y el algoritmo definidos por el sistema.
- Gestionar los errores de las operaciones criptograficas.
- Utilizar Web Crypto API cuando sea compatible con la arquitectura.

CONSIDERACIONES DE SEGURIDAD:
- No exponer claves secretas en la interfaz ni en los registros.
- No confundir la clave HMAC de sesion con la clave de cifrado local.
- No considerar el HMAC como sustituto de la firma digital del boleto.
- Definir previamente los formatos de claves y firmas con los modulos responsables.
*/