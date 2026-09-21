import cron from 'node-cron';
import { eventBus } from '../../core/bus/eventBus.js';
import { TOPICS } from '../../core/bus/topics.js';
import { createAgentLogger } from '../../core/logger/index.js';
import { DNDManager } from './dndManager.js';
import { initDailyBriefingCron } from './dailyBriefing.js';
import { archivistAgent } from '../archivist/archivistAgent.js';
import { watchdogAgent } from '../watchdog/watchdogAgent.js';
import { caretakerAgent } from '../caretaker/caretakerAgent.js';
import { syncCommerceAgent } from '../sync-commerce/syncCommerceAgent.js';

const logger = createAgentLogger('MasterOrchestrator');

export class MasterAgent {
    constructor() {
        this.io = null;
    }

    /**
     * Inisialisasi Master Orchestrator dan seluruh subagen
     * @param {import('socket.io').Server} io - Socket.io instance
     */
    async init(io) {
        this.io = io;
        logger.info('🚀 Menginisialisasi Master Orchestrator & Sub-agent Ecosystem...');

        // 1. Hubungkan Redis Event Bus
        await eventBus.init();

        // 2. Inisialisasi Sub-agent independen
        await Promise.allSettled([
            archivistAgent.init(),
            watchdogAgent.init(),
            caretakerAgent.init(),
            syncCommerceAgent.init()
        ]);

        // 3. Pasang pendengar Alert dari Watchdog (DevOps)
        await eventBus.subscribe(TOPICS.DEVOPS.ALERTS, async (event) => {
            const { action, payload } = event;
            const container = payload?.container || payload?.targetContainer;
            const priority = payload?.priority || 'NORMAL';

            let alertTitle = `⚠️ Container Notice: ${container}`;
            let alertMsg = `Aktivitas devops terdeteksi pada container ${container}`;

            if (action === 'CONTAINER_AUTO_HEALED') {
                alertTitle = `⚠️ Container Auto-Restart: ${container}`;
                alertMsg = `Sayang, container '${container}' sempat berhenti mendadak tapi sudah berhasil Waguri restart otomatis ya! 💕`;
            } else if (action === 'EPHEMERAL_CODER_SPAWNED') {
                alertTitle = `🤖 Ephemeral Coder Dikerahkan: ${container}`;
                alertMsg = `Sayang, kontainer '${container}' mengalami crash berulang. Waguri telah mengerahkan subagen perbaikan '${payload?.ephemeralName}' secara otomatis! 🛠️`;
            } else if (action === 'EPHEMERAL_CODER_DESTROYED') {
                alertTitle = `✅ Ephemeral Coder Selesai: ${container}`;
                alertMsg = `Subagen perbaikan untuk '${container}' telah selesai bertugas dan kontainernya sudah di-destroy secara bersih. Server kembali lega! ✨`;
            }

            // Kirim melewati saringan Smart DND
            await DNDManager.filterAndDispatch(
                { title: alertTitle, message: alertMsg, priority: priority },
                async () => {
                    this.broadcastToClients({
                        status: 'success',
                        response: alertMsg,
                        isProactive: true,
                        type: 'DEVOPS_ALERT',
                        action,
                        data: payload
                    });

                    // Update status di Desk Display ESP32-S3
                    await eventBus.publish(TOPICS.IOT.COMMAND, {
                        sourceAgent: 'MasterAgent',
                        action: 'RENDER_SCREEN',
                        payload: {
                            device: 'desk_display',
                            value: {
                                title: action === 'EPHEMERAL_CODER_SPAWNED' ? 'AUTO REPAIR' : 'DEVOPS OK',
                                body: `${container}: ${action}`,
                                icon: 'alert'
                            }
                        }
                    });
                }
            );
        });

        // Dengarkan siaran jurnal dari Ephemeral Coder di chatroom dan teruskan ke WebSocket
        await eventBus.subscribe(TOPICS.DEVOPS.CHATROOM || 'waguri:chatroom', async (event) => {
            const rawPayload = event.payload || event;
            if (rawPayload?.agentName && rawPayload?.message) {
                this.broadcastToClients({
                    status: 'success',
                    type: 'CHATROOM_LOG',
                    data: rawPayload
                });
            }
        });


        // 4. Inisialisasi Daily Briefing otomatis pukul 07:00 WIB
        initDailyBriefingCron(this.io);

        // 5. Inisialisasi Cron Flush DND Outbox tepat pukul 05:01 WIB
        cron.schedule('1 5 * * *', async () => {
            logger.info('🌅 Pukul 05:01 WIB: Mengosongkan notifikasi Outbox DND...');
            await DNDManager.flushOutbox(async (pendingItems) => {
                for (const item of pendingItems) {
                    this.broadcastToClients({
                        status: 'success',
                        response: `[Tertunda saat jam istirahat] ${item.title}: ${item.message}`,
                        isProactive: true
                    });
                }
            });
        }, {
            timezone: 'Asia/Jakarta'
        });

        // 6. Cron Ekstraksi Memori Harian pukul 23:30 WIB oleh The Archivist
        cron.schedule('30 23 * * *', async () => {
            logger.info('🌙 Menjalankan siklus ekstraksi memori harian...');
            await archivistAgent.extractDailyMemories();
        }, {
            timezone: 'Asia/Jakarta'
        });

        logger.info('✅ Master Orchestrator siap mengawal seluruh agen Waguri.');
    }

    broadcastToClients(payload) {
        if (this.io) {
            this.io.emit('chat_reply', payload);
        }
    }
}

export const masterAgent = new MasterAgent();
