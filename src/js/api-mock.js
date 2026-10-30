// ==========================================
// MÓDULO 5: Simulación de API y Recepción (Módulo 4)
// Responsable: Paloma Herrera Cid
// ==========================================

export const MockModulo4API = {
    /**
     * Simula la petición GET /api/v1/wallet/tickets autenticada con Módulo 1
     */
    async fetchUserTickets() {
        console.log("[API Mock] Solicitando boletos al Módulo 4 con Token de Módulo 1...");
        
        // Simulamos un retraso de red de 400ms
        await new Promise(resolve => setTimeout(resolve, 400));

        // Objeto boleto oficial de prueba 
        const mockResponse = {
            status: "success",
            timestamp: new Date().toISOString(),
            data: {
                tickets: [
                    {
                        ticketId: "BOL-001",
                        event: "Concierto de prueba",
                        date: "10/11/2026",
                        seat: "A12",
                        titular: "Usuario de prueba (Paloma Herrera)",
                        skSession: "SK_SESSION_TEST_9988776654321",
                        signatureECDSA: "MEYCIQDx...mock_ecdsa_signature...==",
                        status: "ACTIVO"
                    }
                ]
            }
        };

        // Guardamos en sessionStorage como mecanismo de entrega simulado
        sessionStorage.setItem("imported_ticket_bol_001", JSON.stringify(mockResponse.data.tickets[0]));
        
        console.log("[API Mock] ¡Boleto BOL-001 recibido y listo para la Wallet!", mockResponse);
        return mockResponse.data.tickets;
    },

    /**
     * Documentación de ajustes necesarios al conectar con el backend real:
     */
    getIntegrationNotes() {
        return {
            modulo1Dependency: "Sustituir el token mock por el JWT real del Header Authorization.",
            modulo4Endpoint: "Cambiar URL simulada por [https://api.ticketengine.internal/v1/tickets](https://api.ticketengine.internal/v1/tickets).",
            cryptoBinding: "Asegurar que la firma ECDSA sea evaluada con la Web Crypto API usando la llave pública oficial de la PKI."
        };
    }
};