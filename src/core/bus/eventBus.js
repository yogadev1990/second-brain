import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import { createAgentLogger } from '../logger/index.js';

const logger = createAgentLogger('RedisEventBus');

/**
 * @typedef {Object} EventMessage
 * @property {string} id
 * @property {string} sourceAgent
 * @property {string} action
 * @property {any} payload
 * @property {string} [replyTo]
 * @property {string} [correlationId]
 * @property {string} timestamp
 */

export class RedisEventBus {
    constructor() {
        const host = process.env.REDIS_HOST || 'localhost';
        const port = Number(process.env.REDIS_PORT) || 6379;
        const url = `redis://${host}:${port}`;

        this.pubClient = createClient({ url });
        this.subClient = createClient({ url });
        this.rpcPending = new Map();
        this.isConnected = false;

        this.pubClient.on('error', (err) => logger.error({ err }, 'Redis Pub Error'));
        this.subClient.on('error', (err) => logger.error({ err }, 'Redis Sub Error'));
    }

    async init() {
        if (this.isConnected) return;
        const candidateHosts = [
            process.env.REDIS_HOST,
            'waguri-redis',
            'redis',
            '127.0.0.1',
            'localhost'
        ].filter(Boolean);

        for (const host of [...new Set(candidateHosts)]) {
            try {
                const port = Number(process.env.REDIS_PORT) || 6379;
                const url = `redis://${host}:${port}`;
                const pub = createClient({ url });
                const sub = createClient({ url });
                pub.on('error', () => {});
                sub.on('error', () => {});

                await pub.connect();
                await sub.connect();

                this.pubClient = pub;
                this.subClient = sub;
                this.pubClient.on('error', (err) => logger.error({ err }, 'Redis Pub Error'));
                this.subClient.on('error', (err) => logger.error({ err }, 'Redis Sub Error'));
                this.isConnected = true;
                logger.info({ host, port }, '✅ Hub Redis EventBus berhasil terhubung ke server.');
                return;
            } catch (err) {
                // Coba kandidat host berikutnya
            }
        }
        logger.warn('Redis belum siap atau tidak aktif di semua target host. Mode fallback aktif.');
    }

    /**
     * Mengirim event satu arah (Broadcast)
     * @param {string} channel
     * @param {Object} event
     */
    async publish(channel, event) {
        if (!this.isConnected) {
            logger.debug({ channel, event }, 'Bypass publish (Redis belum terhubung)');
            return;
        }
        const message = {
            id: uuidv4(),
            timestamp: new Date().toISOString(),
            ...event
        };
        await this.pubClient.publish(channel, JSON.stringify(message));
    }

    /**
     * Berlangganan channel Redis
     * @param {string} channel
     * @param {(event: EventMessage) => Promise<void>} handler
     */
    async subscribe(channel, handler) {
        if (!this.isConnected) return;

        await this.subClient.subscribe(channel, async (rawMessage) => {
            try {
                const parsed = JSON.parse(rawMessage);
                await handler(parsed);
            } catch (err) {
                logger.error({ err, channel, rawMessage }, 'Gagal memproses pesan Redis');
            }
        });
        logger.info(`Berlangganan ke channel Redis: ${channel}`);
    }

    /**
     * Pola RPC (Request - Response asinkron antar agen)
     * @param {string} channel - Channel tujuan
     * @param {string} action - Nama aksi
     * @param {any} payload - Data request
     * @param {string} sourceAgent - Nama agen peminta
     * @param {number} [timeoutMs=8000] - Batas waktu respons
     */
    async request(channel, action, payload, sourceAgent, timeoutMs = 8000) {
        if (!this.isConnected) {
            throw new Error(`Redis tidak terhubung, tidak dapat mengeksekusi RPC: ${action}`);
        }

        const correlationId = uuidv4();
        const replyChannel = `rpc.reply.${sourceAgent}.${correlationId}`;

        return new Promise(async (resolve, reject) => {
            const timer = setTimeout(async () => {
                try {
                    await this.subClient.unsubscribe(replyChannel);
                } catch (_) {}
                this.rpcPending.delete(correlationId);
                reject(new Error(`RPC Timeout (${timeoutMs}ms) untuk aksi '${action}' ke channel '${channel}'`));
            }, timeoutMs);

            this.rpcPending.set(correlationId, (responsePayload) => {
                clearTimeout(timer);
                resolve(responsePayload);
            });

            await this.subClient.subscribe(replyChannel, async (rawReply) => {
                try {
                    const reply = JSON.parse(rawReply);
                    if (reply.correlationId === correlationId) {
                        await this.subClient.unsubscribe(replyChannel);
                        const callback = this.rpcPending.get(correlationId);
                        if (callback) {
                            this.rpcPending.delete(correlationId);
                            callback(reply.payload);
                        }
                    }
                } catch (err) {
                    logger.error({ err }, 'Error parsing RPC reply');
                }
            });

            await this.publish(channel, {
                sourceAgent,
                action,
                payload,
                replyTo: replyChannel,
                correlationId
            });
        });
    }

    /**
     * Mengirimkan balasan untuk request RPC
     * @param {string} replyChannel
     * @param {string} correlationId
     * @param {string} sourceAgent
     * @param {any} payload
     */
    async respond(replyChannel, correlationId, sourceAgent, payload) {
        if (!this.isConnected || !replyChannel) return;
        await this.publish(replyChannel, {
            sourceAgent,
            action: 'RPC_REPLY',
            correlationId,
            payload
        });
    }
}

export const eventBus = new RedisEventBus();
