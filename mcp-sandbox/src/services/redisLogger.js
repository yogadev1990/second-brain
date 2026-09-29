import { createClient } from 'redis';

class RedisLogger {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.channel = process.env.REDIS_CHATROOM_CHANNEL || 'waguri:chatroom';
    }

    async init() {
        const host = process.env.REDIS_HOST || 'localhost';
        const port = process.env.REDIS_PORT || 6379;
        const url = `redis://${host}:${port}`;

        try {
            this.client = createClient({ url });
            this.client.on('error', (err) => {
                console.warn(`[RedisLogger] Redis offline/error (${err.message}). Logging ke console saja.`);
                this.isConnected = false;
            });
            this.client.on('connect', () => {
                console.log(`[RedisLogger] Terhubung ke Redis nervous system (${url}).`);
                this.isConnected = true;
            });
            await this.client.connect();
        } catch (err) {
            console.warn(`[RedisLogger] Inisialisasi Redis gagal: ${err.message}`);
        }
    }

    /**
     * Memancarkan progres pekerjaan ke chatroom Waguri
     * @param {'thinking' | 'working' | 'reporting' | 'done' | 'error'} status 
     * @param {string} message 
     */
    async logProgress(status, message) {
        console.log(`[TheSandbox][${status.toUpperCase()}] ${message}`);

        if (this.isConnected && this.client) {
            try {
                const payload = {
                    agentName: 'TheSandbox',
                    status,
                    message,
                    timestamp: new Date().toISOString()
                };
                await this.client.publish(this.channel, JSON.stringify(payload));
            } catch (err) {
                console.error(`[RedisLogger] Gagal mempublikasikan ke Redis:`, err.message);
            }
        }
    }
}

export const redisLogger = new RedisLogger();
