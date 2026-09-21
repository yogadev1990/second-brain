import Docker from 'dockerode';
import { eventBus } from '../../core/bus/eventBus.js';
import { TOPICS } from '../../core/bus/topics.js';
import { createAgentLogger } from '../../core/logger/index.js';
import { containerUpdater, FAILURE_POLICIES } from '../../services/containerUpdater.js';

const logger = createAgentLogger('TheWatchdog');


// Daftar kontainer target yang dipantau status kesehatannya
const TARGET_CONTAINERS = [
    'revandastore-app',
    'wiki-web',
    'portfolio-site',
    'wiki-game'
];

export class WatchdogAgent {
    constructor() {
        // Hubungkan ke socket Docker daemon Linux/VPS
        this.docker = new Docker({ socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock' });
        this.monitorInterval = null;
        // Pelacak crash berulang per kontainer: Map<string, { count: number, firstCrash: number }>
        this.crashTracker = new Map();
        // Pelacak status kontainer ephemeral yang sedang aktif
        this.activeEphemeralCoders = new Map();
    }

    async init() {
        logger.info('Menginisialisasi Subagen The Watchdog (DevOps & Docker Monitor)...');

        // 1. Dengarkan channel chatroom untuk memantau log progres Ephemeral Subagents
        await eventBus.subscribe(TOPICS.DEVOPS.CHATROOM || 'waguri:chatroom', async (event) => {
            const rawPayload = event.payload || event;
            const { agentName, status, message } = rawPayload || {};

            if (agentName && this.activeEphemeralCoders.has(agentName)) {
                logger.info(
                    { phase: 'Reporting', agentName, status, message },
                    `[Ephemeral Coder Report] Status: [${status}] - ${message}`
                );

                const coderContext = this.activeEphemeralCoders.get(agentName);
                if (coderContext) {
                    coderContext.lastMessage = message;
                    coderContext.lastStatus = status;

                    // Jika agen memancarkan status 'done', picu penyelesaian siklus hidup
                    if (status === 'done' && coderContext.onComplete) {
                        coderContext.onComplete('done');
                    }
                }
            }
        });

        // 2. Dengarkan perintah restart manual dari Master Agent via Redis RPC
        await eventBus.subscribe(TOPICS.DEVOPS.RESTART_CONTAINER, async (event) => {
            const { containerName } = event.payload || {};
            try {
                const result = await this.restartContainer(containerName);
                if (event.replyTo && event.correlationId) {
                    await eventBus.respond(event.replyTo, event.correlationId, 'TheWatchdog', result);
                }
            } catch (err) {
                if (event.replyTo && event.correlationId) {
                    await eventBus.respond(event.replyTo, event.correlationId, 'TheWatchdog', {
                        status: 'error',
                        message: err.message
                    });
                }
            }
        });

        // 3. Dengarkan perintah pembaruan kontainer (Master maupun Layanan Lain) via Redis RPC
        await eventBus.subscribe(TOPICS.DEVOPS.UPDATE_CONTAINER, async (event) => {
            const { containerName, taskDescription, failurePolicy } = event.payload || {};
            try {
                const result = await this.updateTargetContainer(containerName, taskDescription, failurePolicy);
                if (event.replyTo && event.correlationId) {
                    await eventBus.respond(event.replyTo, event.correlationId, 'TheWatchdog', result);
                }
            } catch (err) {
                if (event.replyTo && event.correlationId) {
                    await eventBus.respond(event.replyTo, event.correlationId, 'TheWatchdog', {
                        status: 'error',
                        message: err.message
                    });
                }
            }
        });

        // 4. Jalankan pemantauan otomatis berkala (setiap 60 detik)
        this.startHealthcheckLoop(60000);
        logger.info('✅ The Watchdog aktif dan mengawasi container Docker.');
    }

    startHealthcheckLoop(intervalMs = 60000) {
        if (this.monitorInterval) clearInterval(this.monitorInterval);
        this.monitorInterval = setInterval(async () => {
            await this.evaluateContainers();
        }, intervalMs);
    }

    /**
     * Evaluasi seluruh kontainer terdaftar dan jalankan auto-heal jika crash.
     * Jika terjadi crash berulang (>= 2 kali), picu Dynamic Ephemeral Subagent Spawning.
     */
    async evaluateContainers() {
        logger.debug('Memulai evaluasi kesehatan container Docker...');
        try {
            const containers = await this.docker.listContainers({ all: true });

            for (const targetName of TARGET_CONTAINERS) {
                const matched = containers.find(c =>
                    c.Names && c.Names.some(n => n.replace(/^\//, '') === targetName)
                );

                if (!matched) {
                    logger.debug({ targetName }, 'Container target belum berjalan di host saat ini.');
                    continue;
                }

                // Periksa apakah kontainer dalam keadaan mati (exited/dead)
                if (matched.State !== 'running') {
                    const now = Date.now();
                    const stats = this.crashTracker.get(targetName) || { count: 0, firstCrash: now };

                    // Reset hitungan jika jeda crash sebelumnya lebih dari 15 menit
                    if (now - stats.firstCrash > 15 * 60 * 1000) {
                        stats.count = 1;
                        stats.firstCrash = now;
                    } else {
                        stats.count += 1;
                    }
                    this.crashTracker.set(targetName, stats);

                    logger.error(
                        { targetName, state: matched.State, status: matched.Status, crashCount: stats.count },
                        `⚠️ PERINGATAN KRITIS: Container ${targetName} berhenti mendadak! (Crash ke-${stats.count})`
                    );

                    // Ambil log eror terakhir dari kontainer target untuk diagnosis
                    const targetContainerInstance = this.docker.getContainer(matched.Id);
                    let errorLog = '';
                    try {
                        const logsBuffer = await targetContainerInstance.logs({
                            stdout: true,
                            stderr: true,
                            tail: 80
                        });
                        errorLog = logsBuffer ? logsBuffer.toString('utf-8').trim() : 'Log kontainer kosong.';
                    } catch (logErr) {
                        errorLog = `Gagal menarik log kontainer: ${logErr.message}`;
                    }

                    // Coba auto-restart pertama kali
                    let restartSucceeded = false;
                    try {
                        await this.restartContainer(targetName);
                        restartSucceeded = true;
                    } catch (restartErr) {
                        logger.error({ targetName, err: restartErr.message }, 'Gagal melakukan auto-restart otomatis.');
                    }

                    // Kirim alert darurat prioritas tinggi ke Master Agent via Redis Pub/Sub
                    await eventBus.publish(TOPICS.DEVOPS.ALERTS, {
                        sourceAgent: 'TheWatchdog',
                        action: 'CONTAINER_AUTO_HEALED',
                        payload: {
                            container: targetName,
                            previousState: matched.State,
                            status: matched.Status,
                            crashCount: stats.count,
                            restartedAt: new Date().toISOString(),
                            priority: 'CRITICAL'
                        }
                    });

                    // Pemicu Otomatis Ephemeral Coder:
                    // Jika kontainer crash berulang (>= 2x) atau gagal direstart
                    if (stats.count >= 2 || !restartSucceeded) {
                        logger.warn(
                            { targetName, crashCount: stats.count },
                            `⚠️ Kontainer mengalami crash berulang. Memicu Dynamic Ephemeral Subagent Spawning...`
                        );
                        // Jalankan spawning tanpa memblokir thread loop
                        this.spawnEphemeralCoder(targetName, errorLog).catch(spawnErr => {
                            logger.error({ targetName, err: spawnErr.message }, 'Gagal memicu spawnEphemeralCoder.');
                        });
                    }
                } else {
                    // Jika kontainer sudah kembali normal berjalan, bersihkan riwayat crash secara bertahap
                    const stats = this.crashTracker.get(targetName);
                    if (stats && Date.now() - stats.firstCrash > 20 * 60 * 1000) {
                        this.crashTracker.delete(targetName);
                    }
                }
            }
        } catch (error) {
            logger.warn({ err: error.message }, 'Tidak dapat membaca socket Docker daemon (kemungkinan di Windows dev environment).');
        }
    }

    /**
     * FUNGSI PEMICU & PENGELOLA SIKLUS HIDUP: Dynamic Ephemeral Subagent Spawning
     * 
     * @param {string} targetContainerName - Nama kontainer yang bermasalah
     * @param {string} errorLog - Cuplikan log eror/crash terakhir
     * @returns {Promise<{ status: string, agentName: string, message: string }>}
     */
    async spawnEphemeralCoder(targetContainerName, errorLog) {
        // Validasi dan sanitasi input nama kontainer
        if (!targetContainerName || !/^[a-zA-Z0-9_.-]+$/.test(targetContainerName)) {
            throw new Error(`Nama kontainer tidak valid: ${targetContainerName}`);
        }

        const ephemeralImage = process.env.EPHEMERAL_CODER_IMAGE || 'waguri-coder-base:latest';
        const ephemeralName = `ephemeral-coder-${targetContainerName}-${Date.now()}`;

        // -------------------------------------------------------------
        // FASE 1: SPAWNING (Persiapan & Konfigurasi Binds / Network)
        // -------------------------------------------------------------
        logger.info(
            { phase: 'Spawning', targetContainerName, ephemeralName, image: ephemeralImage },
            `[Ephemeral Coder Lifecycle] Memulai proses spawning subagen perbaikan untuk '${targetContainerName}'...`
        );

        let targetBinds = [];
        let targetNetwork = process.env.DOCKER_NETWORK || 'waguri-internal';

        try {
            const targetContainer = this.docker.getContainer(targetContainerName);
            const inspectData = await targetContainer.inspect().catch(() => null);

            if (inspectData) {
                // Ekstraksi volume binds yang digunakan oleh kontainer target
                if (inspectData.HostConfig && Array.isArray(inspectData.HostConfig.Binds)) {
                    // Petakan bind host kontainer target ke folder /workspace di kontainer ephemeral
                    inspectData.HostConfig.Binds.forEach(bind => {
                        const parts = bind.split(':');
                        if (parts.length >= 2) {
                            const hostSource = parts[0];
                            targetBinds.push(`${hostSource}:/workspace:rw`);
                        }
                    });
                }

                // Identifikasi network yang terhubung
                if (inspectData.NetworkSettings && inspectData.NetworkSettings.Networks) {
                    const networks = Object.keys(inspectData.NetworkSettings.Networks);
                    if (networks.length > 0) {
                        targetNetwork = networks[0];
                    }
                }
            }
        } catch (inspectErr) {
            logger.warn({ err: inspectErr.message }, 'Gagal menginspeksi kontainer target, menggunakan konfigurasi fallback binds.');
        }

        // Fallback jika tidak ada binds terdeteksi
        if (targetBinds.length === 0) {
            targetBinds.push(`/var/www/${targetContainerName}:/workspace:rw`);
        }

        // Mount Docker socket secara read-only untuk membatasi hak akses agar aman dari exploit
        targetBinds.push('/var/run/docker.sock:/var/run/docker.sock:ro');

        let ephemeralContainer = null;

        try {
            // Konfigurasi Container Creation via Dockerode
            ephemeralContainer = await this.docker.createContainer({
                Image: ephemeralImage,
                name: ephemeralName,
                Env: [
                    `TARGET_CONTAINER=${targetContainerName}`,
                    `ERROR_LOG=${Buffer.from(errorLog || '').toString('base64')}`,
                    `ERROR_LOG_RAW=${(errorLog || '').slice(-500)}`,
                    `REDIS_HOST=${process.env.REDIS_HOST || 'redis'}`,
                    `REDIS_PORT=${process.env.REDIS_PORT || '6379'}`,
                    `CHATROOM_CHANNEL=${TOPICS.DEVOPS.CHATROOM || 'waguri:chatroom'}`,
                    `AGENT_NAME=${ephemeralName}`,
                    `NODE_ENV=production`
                ],
                HostConfig: {
                    Binds: targetBinds,
                    NetworkMode: targetNetwork,
                    AutoRemove: false, // Dikelola manual oleh Watchdog untuk observabilitas penuh
                    Memory: 512 * 1024 * 1024, // Batasi RAM maksimal 512MB
                    NanoCpus: 1000000000 // Batasi 1 CPU Core
                },
                Labels: {
                    'creator': 'waguri-watchdog',
                    'type': 'ephemeral-subagent',
                    'target': targetContainerName
                }
            });

            // -------------------------------------------------------------
            // FASE 2: RUNNING (Kontainer Dinyalakan)
            // -------------------------------------------------------------
            await ephemeralContainer.start();

            logger.info(
                { phase: 'Running', ephemeralName, targetContainerName, network: targetNetwork },
                `[Ephemeral Coder Lifecycle] Kontainer '${ephemeralName}' berhasil running dan terhubung ke Redis.`
            );

            // Siarkan alert ke Master Agent bahwa Ephemeral Coder telah dikerahkan
            await eventBus.publish(TOPICS.DEVOPS.ALERTS, {
                sourceAgent: 'TheWatchdog',
                action: 'EPHEMERAL_CODER_SPAWNED',
                payload: {
                    ephemeralName,
                    targetContainer: targetContainerName,
                    startedAt: new Date().toISOString(),
                    priority: 'HIGH'
                }
            });

            // -------------------------------------------------------------
            // FASE 3: REPORTING & MONITORING (Menunggu Status 'done' atau Exit)
            // -------------------------------------------------------------
            const maxExecutionTimeoutMs = 5 * 60 * 1000; // Batas waktu maksimal 5 menit

            await new Promise((resolve) => {
                let timeoutHandle = null;

                const cleanupContext = (reason) => {
                    if (timeoutHandle) clearTimeout(timeoutHandle);
                    this.activeEphemeralCoders.delete(ephemeralName);
                    resolve(reason);
                };

                // Daftarkan callback penyelesaian dari Redis Pub/Sub status 'done'
                this.activeEphemeralCoders.set(ephemeralName, {
                    targetContainerName,
                    startedAt: Date.now(),
                    onComplete: (reason) => {
                        logger.info({ phase: 'Reporting', ephemeralName, reason }, 'Menerima sinyal penyelesaian dari chatroom.');
                        cleanupContext(reason);
                    }
                });

                // Batas waktu keamanan (Safety Timeout)
                timeoutHandle = setTimeout(() => {
                    logger.warn({ phase: 'Reporting', ephemeralName }, 'Batas waktu eksekusi (5 menit) tercapai.');
                    cleanupContext('timeout');
                }, maxExecutionTimeoutMs);

                // Pantau juga apakah kontainer exit secara alami
                ephemeralContainer.wait().then((data) => {
                    const exitCode = data?.StatusCode ?? 0;
                    logger.info({ phase: 'Reporting', ephemeralName, exitCode }, `Kontainer ephemeral telah exit dengan kode: ${exitCode}`);
                    cleanupContext(`exit_code_${exitCode}`);
                }).catch(() => {
                    // Ignore error jika kontainer di-stop manual
                });
            });

            return {
                status: 'success',
                agentName: ephemeralName,
                message: `Ephemeral Coder Subagent untuk '${targetContainerName}' telah menyelesaikan siklus hidupnya.`
            };

        } catch (error) {
            logger.error(
                { phase: 'Spawning', ephemeralName, targetContainerName, err: error.message },
                'Gagal mengeksekusi siklus hidup Ephemeral Coder Subagent.'
            );
            throw error;
        } finally {
            // -------------------------------------------------------------
            // FASE 4: DESTROYED (Self-Destruct & Pembersihan Sumber Daya Bersih)
            // -------------------------------------------------------------
            if (ephemeralContainer) {
                try {
                    const info = await ephemeralContainer.inspect().catch(() => null);
                    if (info && info.State && info.State.Running) {
                        logger.info({ phase: 'Destroyed', ephemeralName }, 'Menghentikan kontainer ephemeral yang masih aktif...');
                        await ephemeralContainer.stop({ t: 3 }).catch(() => {});
                    }
                    logger.info({ phase: 'Destroyed', ephemeralName }, 'Menghapus kontainer ephemeral (Clean Self-Destruct)...');
                    await ephemeralContainer.remove({ force: true, v: true }).catch(() => {});

                    logger.info(
                        { phase: 'Destroyed', ephemeralName, targetContainerName },
                        `[Ephemeral Coder Lifecycle] Kontainer '${ephemeralName}' berhasil di-destroy secara bersih. RAM dan CPU server telah dilepaskan.`
                    );

                    // Beritahu Master Agent bahwa perbaikan telah selesai dan memori server bersih
                    await eventBus.publish(TOPICS.DEVOPS.ALERTS, {
                        sourceAgent: 'TheWatchdog',
                        action: 'EPHEMERAL_CODER_DESTROYED',
                        payload: {
                            ephemeralName,
                            targetContainer: targetContainerName,
                            destroyedAt: new Date().toISOString(),
                            priority: 'NORMAL'
                        }
                    });

                } catch (cleanupErr) {
                    logger.error({ phase: 'Destroyed', ephemeralName, err: cleanupErr.message }, 'Gagal membersihkan kontainer ephemeral.');
                }
            }
        }
    }

    /**
     * Restart container secara aman melalui Docker API (Bebas dari Command Injection)
     * @param {string} containerName
     */
    async restartContainer(containerName) {
        if (!containerName || !/^[a-zA-Z0-9_.-]+$/.test(containerName)) {
            throw new Error(`Nama container tidak valid atau mengandung karakter ilegal: ${containerName}`);
        }

        const container = this.docker.getContainer(containerName);
        await container.restart();
        logger.info({ containerName }, 'Container berhasil direstart via Docker Engine API.');
        return {
            status: 'success',
            message: `Container '${containerName}' berhasil direstart dengan aman.`
        };
    }

    /**
     * Memperbarui kontainer target menggunakan Universal Blue-Green & Failure Recovery Engine
     * @param {string} containerName
     * @param {string} taskDescription
     * @param {string} [failurePolicy]
     */
    async updateTargetContainer(containerName, taskDescription, failurePolicy = FAILURE_POLICIES.AUTO_REPAIR_THEN_ROLLBACK) {
        return await containerUpdater.updateContainer({
            containerName,
            taskDescription,
            failurePolicy
        });
    }
}

export const watchdogAgent = new WatchdogAgent();

/**
 * Helper ekspor langsung agar dapat dipanggil secara modular di bagian sistem lain
 */
export async function spawnEphemeralCoder(targetContainerName, errorLog) {
    return await watchdogAgent.spawnEphemeralCoder(targetContainerName, errorLog);
}

export async function updateTargetContainer(targetContainerName, taskDescription, failurePolicy) {
    return await watchdogAgent.updateTargetContainer(targetContainerName, taskDescription, failurePolicy);
}

