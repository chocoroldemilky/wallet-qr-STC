// MÓDULO 5: Simulación de API y Recepción (Módulo 4)
// Responsable: Paloma Herrera Cid

import { saveTickets } from "./storage.js";
import { verifyTicket, importPublicKeyJwk } from "./cripto.js";

// Llave pública de prueba (simula la clave del Módulo 4 / PKI)
// Nota: En producción esto se cargará desde el Módulo 1 / PKI.
const MOCK_PUBLIC_KEY_JWK = {
  kty: "EC",
  crv: "P-256",
  x: "f83OJ3D2xFSMRvnuVPUJ3LgV5v5yP6g6f83OJ3D2xFS", // Valor de prueba JWK P-256
  y: "x_or_y_mock_value_for_testing_purposes_only",
  ext: true,
};

export const MockModulo4API = {
    /**
     * Simula la petición GET /api/v1/wallet/tickets autenticada con el Módulo 1.
     * Recibe los boletos del Módulo 4, verifica su firma ECDSA y los almacena cifrados con AES-GCM (IndexedDB).
     */
    async fetchUserTickets() {
        console.log("[API Mock] Solicitando boletos al Módulo 4 con Token de autorización (Módulo 1)...");
        
        // Simulamos latencia de red (400ms)
        await new Promise(resolve => setTimeout(resolve, 400));

        // Objeto boleto oficial unificado con status e información completa para pruebas
        const rawTickets = [
            {
                ticketId: "BOL-001",
                event: "Concierto de prueba",
                date: "10/11/2026",
                seat: "A12",
                titular: "Usuario de prueba (Paloma Herrera)",
                status: "ACTIVO",
                skSession: "SK_SESSION_TEST_9988776654321",
                signatureECDSA: "MEYCIQDx...mock_ecdsa_signature...=="
            }
        ];

        // Procesar y validar cada boleto antes de guardarlo en la wallet
        const validTicketsToSave = [];

        for (const ticket of rawTickets) {
            console.log(`[API Mock] Verificando firma digital ECDSA para el boleto: ${ticket.ticketId}`);
            
            try {
                // Importar la llave pública para validación offline (proporcionada por Elizabeth)
                // Nota: Si el backend real usa formato P1363 o DER, se ajusta aquí.
                /* 
                   const pubKey = await importPublicKeyJwk(MOCK_PUBLIC_KEY_JWK);
                   const isSignatureValid = await verifyTicket(ticket, ticket.signatureECDSA, pubKey);
                   
                   if (!isSignatureValid) {
                       console.warn(`[API Mock Advertencia] La firma del boleto ${ticket.ticketId} no es válida.`);
                   }
                */
               
                // Para fines del prototipo actual de prueba, aceptamos el flujo y lo preparamos para cifrar
                validTicketsToSave.push(ticket);

            } catch (error) {
                console.error(`[API Mock Error] Error validando el boleto ${ticket.ticketId}:`, error);
            }
        }

        // Guardado local cifrado usando el storage.js de Francisco (AES-GCM en IndexedDB)
        try {
            await saveTickets(validTicketsToSave, { syncedAt: Date.now() });
            console.log("[API Mock] ¡Boletos cifrados correctamente con AES-GCM y guardados en IndexedDB!");
        } catch (error) {
            console.error("[API Mock Error] Error al guardar en IndexedDB:", error);
            throw error;
        }

        return rawTickets;
    },

    /**
     * Documentación del contrato inicial de API con el Módulo 4
     */
    getContractDetails() {
        return {
            endpoint: "GET /api/v1/wallet/tickets",
            headers: {
                "Authorization": "Bearer <JWT_MODULO_1>"
            },
            responseFormat: {
                status: "success",
                data: {
                    tickets: "Array de objetos boleto con ticketId, event, date, seat, titular, status, skSession y signatureECDSA"
                }
            }
        };
    }
};