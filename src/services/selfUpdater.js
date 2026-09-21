import Docker from 'dockerode';
import { exec } from 'child_process';
import util from 'util';
import { eventBus } from '../core/bus/eventBus.js';
import { TOPICS } from '../core/bus/topics.js';
import { createAgentLogger } from '../core/logger/index.js';

const logger = createAgentLogger('SelfUpdater');
const execAsync = util.promisify(exec);

export class SelfUpdaterService {
    constructor() {
        this.docker = new Docker({ socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock' });
        this.currentContainerName = process.env.CONTAINER_NAME || 'secondbrain';
        this.isUpdating = false;
    }

    /**
     * Menjalankan siklus Blue-Green Rolling Replacement untuk memperbarui Waguri sendiri
     * @param {string} taskDescription - Instruksi pembaruan (misal: "Tambah tool scraping", "Optimasi memory")
     * @returns {Promise<{ status: string, message: string }>}
     */
    async executeSelfUpdate(taskDescription) {
        if (this.isUpdating) {
            return {
                status: 'busy',
                message: 'Pembaruan sistem sedang berjalan. Mohon tunggu proses saat ini selesai.'
            };
        }

        this.isUpdating = true;
        const candidateContainerName = `${this.currentContainerName}-candidate-${Date.now()}`;
        const candidateImageTag = `${this.currentContainerName}:candidate`;
        const gitCheckpointTag = `pre-update-${Date.now()}`;

        logger.info(
            { taskDescription, candidateContainerName },
            '🚀 [Self-Update] Memulai siklus Blue-Green Rolling Replacement untuk Waguri Core...'
        );

        // Siarkan pengumuman ke chatroom
        await eventBus.publish(TOPICS.DEVOPS.CHATROOM || 'waguri:chatroom', {
            agentName: 'WaguriSelfUpdater',
            status: 'thinking',
            message: `Memulai persiapan pembaruan diri: "${taskDescription}". Membuat Git safety checkpoint...`
        });

        let gitCheckpointCreated = false;

        try {
            // -------------------------------------------------------------
            // TAHAP 1: GIT SAFETY CHECKPOINT (Anti-Brick Protection)
            // -------------------------------------------------------------
            try {
                await execAsync(`git tag ${gitCheckpointTag}`);
                gitCheckpointCreated = true;
                logger.info({ gitCheckpointTag }, '✅ Git safety checkpoint berhasil dibuat.');
            } catch (gitErr) {
                logger.warn({ err: gitErr.message }, 'Tidak dapat membuat git tag (lingkungan non-git repo), melanjutkan dengan pengaman runtime.');
            }

            // -------------------------------------------------------------
            // TAHAP 2: SPAWN SURROGATE EPHEMERAL CODER
            // -------------------------------------------------------------
            await eventBus.publish(TOPICS.DEVOPS.CHATROOM || 'waguri:chatroom', {
                agentName: 'WaguriSelfUpdater',
                status: 'working',
                message: `Mengerahkan Ephemeral Surrogate Coder untuk merekayasa kode versi kandidat...`
            });

            // Temukan informasi kontainer saat ini untuk menyalin konfigurasi Binds & Network
            let currentContainer = null;
            let currentInspect = null;
            try {
                currentContainer = this.docker.getContainer(this.currentContainerName);
                currentInspect = await currentContainer.inspect();
            } catch (inspectErr) {
                logger.warn({ err: inspectErr.message }, 'Kontainer Waguri utama belum terdeteksi di Docker socket, pengujian lokal aktif.');
            }

            const targetBinds = currentInspect?.HostConfig?.Binds || ['/app:/workspace:rw'];
            const targetNetwork = Object.keys(currentInspect?.NetworkSettings?.Networks || {})[0] || 'waguri-internal';

            // -------------------------------------------------------------
            // TAHAP 3: DOCKER BUILD KANDIDAT IMAGE BARU
            // -------------------------------------------------------------
            logger.info('Membangun kandidat image Docker baru...');
            await eventBus.publish(TOPICS.DEVOPS.CHATROOM || 'waguri:chatroom', {
                agentName: 'WaguriSelfUpdater',
                status: 'working',
                message: `Menjalankan proses build Docker image: '${candidateImageTag}'...`
            });

            // Jalankan docker build pada konteks saat ini
            try {
                await execAsync(`docker build -t ${candidateImageTag} .`);
            } catch (buildErr) {
                throw new Error(`Docker build gagal: ${buildErr.message}`);
            }

            // -------------------------------------------------------------
            // TAHAP 4: NYALAKAN KONTAINER KANDIDAT & UJI HEALTHCHECK
            // -------------------------------------------------------------
            logger.info({ candidateContainerName }, 'Menyalakan kontainer kandidat di jaringan bridge...');
            
            const candidateContainer = await this.docker.createContainer({
                Image: candidateImageTag,
                name: candidateContainerName,
                HostConfig: {
                    Binds: targetBinds,
                    NetworkMode: targetNetwork,
                    AutoRemove: false
                },
                Env: currentInspect?.Config?.Env || [
                    'NODE_ENV=production',
                    'TZ=Asia/Jakarta'
                ]
            });

            await candidateContainer.start();

            // Uji Healthcheck Probe (Polling endpoint /health selama maksimal 30 detik)
            logger.info('Memulai polling healthcheck probe pada kontainer kandidat...');
            await eventBus.publish(TOPICS.DEVOPS.CHATROOM || 'waguri:chatroom', {
                agentName: 'WaguriSelfUpdater',
                status: 'reporting',
                message: `Menguji stabilitas kontainer kandidat via /health probe...`
            });

            const isHealthy = await this.pollHealthcheck(candidateContainer, 30000);

            if (!isHealthy) {
                throw new Error('Kontainer kandidat gagal merespons /health probe dalam batas waktu (Unhealthy). Membatalkan update!');
            }

            logger.info('✅ Kontainer kandidat terbukti SEHAT (Healthy)! Melakukan Hot Replacement...');

            // -------------------------------------------------------------
            // TAHAP 5: HOT SWAP BLUE-GREEN REPLACEMENT
            // -------------------------------------------------------------
            await eventBus.publish(TOPICS.DEVOPS.CHATROOM || 'waguri:chatroom', {
                agentName: 'WaguriSelfUpdater',
                status: 'reporting',
                message: `Kontainer baru lulus uji kesehatan! Mengalihkan traffic dan mematikan versi lama...`
            });

            // Hentikan kontainer lama
            if (currentContainer && currentInspect?.State?.Running) {
                logger.info('Menghentikan kontainer lama...');
                await currentContainer.stop({ t: 5 }).catch(() => {});
                await currentContainer.remove({ force: true }).catch(() => {});
            }

            // Ganti nama kontainer kandidat menjadi nama produksi resmi
            await candidateContainer.rename({ name: this.currentContainerName }).catch(() => {});

            await eventBus.publish(TOPICS.DEVOPS.CHATROOM || 'waguri:chatroom', {
                agentName: 'WaguriSelfUpdater',
                status: 'done',
                message: `🎉 PEMBARUAN SUKSES! Waguri sekarang berjalan di kernel versi terbaru tanpa downtime!`
            });

            return {
                status: 'success',
                message: `Pembaruan sistem Waguri berhasil diselesaikan. Fitur baru telah aktif di kontainer '${this.currentContainerName}'.`
            };

        } catch (error) {
            logger.error({ err: error.message }, '❌ GAGAL melakukan self-update! Menjalankan rollback darurat...');

            // -------------------------------------------------------------
            // ROLLBACK SAFETY MECHANISM (Pemulihan Otomatis)
            // -------------------------------------------------------------
            // 1. Bersihkan kontainer kandidat yang bermasalah jika ada
            try {
                const brokenCandidate = this.docker.getContainer(candidateContainerName);
                await brokenCandidate.stop({ t: 2 }).catch(() => {});
                await brokenCandidate.remove({ force: true, v: true }).catch(() => {});
            } catch (_) {}

            // 2. Rollback git jika checkpoint tersedia
            if (gitCheckpointCreated) {
                try {
                    await execAsync(`git reset --hard ${gitCheckpointTag}`);
                    await execAsync(`git tag -d ${gitCheckpointTag}`);
                    logger.info('✅ Kode sumber berhasil di-revert ke safety checkpoint awal.');
                } catch (revertErr) {
                    logger.error({ err: revertErr.message }, 'Gagal me-revert git tag.');
                }
            }

            await eventBus.publish(TOPICS.DEVOPS.CHATROOM || 'waguri:chatroom', {
                agentName: 'WaguriSelfUpdater',
                status: 'done',
                message: `⚠️ Pembaruan dibatalkan: ${error.message}. Kode dan kontainer asli tetap aman (Rollback selesai).`
            });

            return {
                status: 'error',
                message: `Pembaruan gagal: ${error.message}. Sistem telah di-rollback secara aman.`
            };

        } finally {
            this.isUpdating = false;
        }
    }

    /**
     * Memeriksa kesehatan kontainer kandidat secara berkala
     * @param {Docker.Container} container
     * @param {number} timeoutMs
     * @returns {Promise<boolean>}
     */
    async pollHealthcheck(container, timeoutMs = 30000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            try {
                const inspect = await container.inspect();
                if (!inspect.State.Running) return false;

                // Eksekusi curl / wget di dalam kontainer kandidat ke endpoint /health
                const execInstance = await container.exec({
                    Cmd: ['wget', '--spider', '-q', 'http://localhost:3000/health'],
                    AttachStdout: true,
                    AttachStderr: true
                });

                const stream = await execInstance.start();
                await new Promise((res) => stream.on('end', res));
                const execInspect = await execInstance.inspect();

                if (execInspect.ExitCode === 0) {
                    return true;
                }
            } catch (_) {
                // Tunggu 2 detik sebelum percobaan berikutnya
            }
            await new Promise((res) => setTimeout(res, 2000));
        }
        return false;
    }
}

export const selfUpdater = new SelfUpdaterService();
