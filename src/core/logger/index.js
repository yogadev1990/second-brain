import pino from 'pino';

/**
 * Membuat instance logger Pino terstruktur untuk agen tertentu.
 * Format output JSON di production, atau format readable di development.
 * 
 * @param {string} agentName - Nama agen (misal: 'MasterOrchestrator', 'TheArchivist')
 * @returns {pino.Logger}
 */
export function createAgentLogger(agentName) {
    const isDev = process.env.NODE_ENV !== 'production';

    return pino({
        name: agentName,
        level: process.env.LOG_LEVEL || 'info',
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
            level: (label) => ({ level: label.toUpperCase() }),
            bindings: (bindings) => ({
                agent: agentName,
                pid: bindings.pid,
                hostname: bindings.hostname
            })
        },
        transport: isDev ? {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
                ignore: 'pid,hostname'
            }
        } : undefined
    });
}

export const defaultLogger = createAgentLogger('WaguriCore');
