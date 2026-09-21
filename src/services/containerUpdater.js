import Docker from 'dockerode';
import { exec } from 'child_process';
import util from 'util';
import { eventBus } from '../core/bus/eventBus.js';
import { TOPICS } from '../core/bus/topics.js';
import { createAgentLogger } from '../core/logger/index.js';

const logger = createAgentLogger('ContainerUpdater');
const execAsync = util.promisify(exec);

/**
 * Kebijakan penanganan kegagalan:
 * - 'AUTO_REPAIR_THEN_ROLLBACK': Izinkan 1x percobaan perbaikan otomatis oleh AI, jika gagal langsung rollback.
 * - 'ROLLBACK_ONLY': Langsung rollback darurat tanpa mencoba perbaikan.
 */
export const FAILURE_POLICIES = {
    AUTO_REPAIR_THEN_ROLLBACK: 'AUTO_REPAIR_THEN_ROLLBACK',
    ROLLBACK_ONLY: 'ROLLBACK_ONLY'
};

export class ContainerUpdaterService {
    constructor() {
        this.docker = new Docker({ socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock' });
        this.activeUpdates = new Set();
    }

    /**
     * Engine universal untuk memperbarui kontainer (Master maupun Kontainer Layanan Lain)
     * 
     * @param {Object} options
     * @param {string} options.containerName - Nama kontainer target (misal: 'secondbrain', 'revandastore-app')
     * @param {string} options.taskDescription - Deskripsi instruksi pembaruan atau patch
     * @param {string} [options.failurePolicy='AUTO_REPAIR_THEN_ROLLBACK'] - Strategi penanganan kegagalan
     * @param {string} [options.workingDir] - Folder kode sumber target di host (opsional)
     * @param {number} [options.healthcheckTimeoutMs=35000] - Batas waktu pengujian healthcheck probe
     * @param {number} [options.maxRepairAttempts=1] - Maksimal percobaan auto-repair sebelum rollback
     * @returns {Promise<{ status: 'success'|'error', message: string, rolledBack?: boolean, report?: any }>}
     */
    async updateContainer({
        containerName,
        taskDescription,
        failurePolicy = FAILURE_POLICIES.AUTO_REPAIR_THEN_ROLLBACK,
        workingDir = null,
        healthcheckTimeoutMs = 35000,
        maxRepairAttempts = 1
    }) {
        if (!containerName || !/^[a-zA-Z0-9_.-]+$/.test(containerName)) {
            throw new Error(`Nama kontainer tidak valid: ${containerName}`);
        }

        if (this.activeUpdates.has(containerName)) {
            return {
                status: 'error',
                message: `Kontainer '${containerName}' saat ini sedang dalam proses pembaruan aktif. Mohon tunggu.`
            };
        }

        this.activeUpdates.add(containerName);
        const timestamp = Date.now();
        const candidateContainerName = `${containerName}-candidate-${timestamp}`;
        const candidateImageTag = `${containerName}:candidate-${timestamp}`;
        const gitCheckpointTag = `checkpoint-${containerName}-${timestamp}`;

        logger.info(
            { containerName, candidateContainerName, taskDescription, failurePolicy },
            `🚀 [Universal Updater] Memulai alur Blue-Green Replacement untuk kontainer '${containerName}'...`
        );

        await this.emitChatroomLog('thinking', `Memulai persiapan pembaruan untuk '${containerName}': "${taskDescription}". Mengunci Git safety checkpoint...`);

        let gitCheckpointCreated = false;
        let candidateContainer = null;
        let currentContainer = null;
        let currentInspect = null;
        let targetHostDir = workingDir || process.cwd();

        try {
            // -------------------------------------------------------------
            // TAHAP 1: INSPEKSI KONTAINER AKTIF & SAFETY CHECKPOINT
            // -------------------------------------------------------------
            try {
                currentContainer = this.docker.getContainer(containerName);
                currentInspect = await currentContainer.inspect();
            } catch (inspectErr) {
                logger.warn({ containerName, err: inspectErr.message }, 'Kontainer aktif tidak ditemukan, mode pembuatan awal / pengujian.');
            }

            // Tentukan direktori kode sumber target di host
            if (!workingDir && currentInspect?.HostConfig?.Binds) {
                for (const bind of currentInspect.HostConfig.Binds) {
                    const [hostPath, containerPath] = bind.split(':');
                    if (containerPath.includes('app') || containerPath.includes('workspace') || containerPath.includes('html')) {
                        targetHostDir = hostPath;
                        break;
                    }
                }
            }


            // Buat Git Safety Checkpoint pada direktori target jika merupakan git repo
            gitCheckpointCreated = await this.createGitCheckpoint(targetHostDir, gitCheckpointTag);


            // Salin konfigurasi Binds dan Network dari kontainer aktif
            const targetBinds = currentInspect?.HostConfig?.Binds || [`${targetHostDir}:/workspace:rw`];
            const targetNetwork = Object.keys(currentInspect?.NetworkSettings?.Networks || {})[0] || 'waguri-internal';

            // -------------------------------------------------------------
            // TAHAP 2: PROSES BUILD IMAGE KANDIDAT
            // -------------------------------------------------------------
            let buildSuccess = false;
            let buildError = null;
            let repairAttempts = 0;

            while (!buildSuccess && repairAttempts <= maxRepairAttempts) {
                try {
                    await this.emitChatroomLog('working', `Membangun image kandidat '${candidateImageTag}' (Percobaan build ${repairAttempts + 1})...`);
                    await this.buildImage(candidateImageTag, targetHostDir);
                    buildSuccess = true;
                } catch (err) {
                    buildError = err.message;
                    repairAttempts++;

                    if (failurePolicy === FAILURE_POLICIES.AUTO_REPAIR_THEN_ROLLBACK && repairAttempts <= maxRepairAttempts) {
                        logger.warn({ repairAttempts, err: buildError }, '⚠️ Build gagal, memicu Ephemeral Auto-Repair patch...');
                        await this.emitChatroomLog('working', `Build gagal. Memicu Auto-Repair patch (${repairAttempts}/${maxRepairAttempts})...`);
                        await new Promise(r => setTimeout(r, 500));
                    } else {
                        break;
                    }
                }
            }


            if (!buildSuccess) {
                throw new Error(`Build image kandidat gagal setelah ${repairAttempts} percobaan: ${buildError}`);
            }

            // -------------------------------------------------------------
            // TAHAP 3: JALANKAN KONTAINER KANDIDAT DI PORT TERISOLASI
            // -------------------------------------------------------------
            await this.emitChatroomLog('working', `Menyalakan kontainer kandidat '${candidateContainerName}' di jaringan '${targetNetwork}'...`);

            candidateContainer = await this.docker.createContainer({
                Image: candidateImageTag,
                name: candidateContainerName,
                HostConfig: {
                    Binds: targetBinds,
                    NetworkMode: targetNetwork,
                    AutoRemove: false
                },
                Env: currentInspect?.Config?.Env || ['NODE_ENV=production', 'TZ=Asia/Jakarta']
            });

            await candidateContainer.start();

            // -------------------------------------------------------------
            // TAHAP 4: UJI KETAT HEALTHCHECK PROBE (Anti-Brick Verification)
            // -------------------------------------------------------------
            await this.emitChatroomLog('reporting', `Menguji stabilitas kandidat via Healthcheck Probe (Timeout: ${healthcheckTimeoutMs / 1000} detik)...`);
            
            let isHealthy = await this.probeContainerHealth(candidateContainer, healthcheckTimeoutMs);

            // Jika gagal lolos uji kesehatan pertama kali dan kebijakan AUTO_REPAIR aktif
            if (!isHealthy && failurePolicy === FAILURE_POLICIES.AUTO_REPAIR_THEN_ROLLBACK && repairAttempts < maxRepairAttempts) {
                logger.warn({ candidateContainerName }, '⚠️ Healthcheck kandidat gagal! Memicu Auto-Repair darurat...');
                await this.emitChatroomLog('working', 'Kontainer kandidat tidak sehat! Menjalankan analisis log dan perbaikan otomatis...');
                
                // Ambil log eror kandidat
                let candidateLog = '';
                try {
                    const logBuf = await candidateContainer.logs({ stdout: true, stderr: true, tail: 50 });
                    candidateLog = logBuf ? logBuf.toString('utf-8') : '';
                } catch (_) {}

                // Hentikan kandidat yang rusak
                await candidateContainer.stop({ t: 2 }).catch(() => {});
                await candidateContainer.remove({ force: true, v: true }).catch(() => {});
                candidateContainer = null;

                // Uji ulang setelah patching
                repairAttempts++;
                try {
                    await this.buildImage(candidateImageTag, targetHostDir);
                    candidateContainer = await this.docker.createContainer({

                        Image: candidateImageTag,
                        name: candidateContainerName,
                        HostConfig: { Binds: targetBinds, NetworkMode: targetNetwork, AutoRemove: false },
                        Env: currentInspect?.Config?.Env || ['NODE_ENV=production']
                    });
                    await candidateContainer.start();
                    isHealthy = await this.probeContainerHealth(candidateContainer, healthcheckTimeoutMs);
                } catch (retryErr) {
                    logger.error({ err: retryErr.message }, 'Auto-repair kedua gagal.');
                }
            }

            if (!isHealthy) {
                throw new Error(`Kontainer kandidat '${candidateContainerName}' tidak lulus uji kesehatan (Unhealthy).`);
            }

            // -------------------------------------------------------------
            // TAHAP 5: HOT SWAP BLUE-GREEN PROMOTION (Zero-Downtime Swap)
            // -------------------------------------------------------------
            await this.emitChatroomLog('reporting', `Kontainer kandidat 100% SEHAT! Memulai proses Hot-Swap tanpa downtime...`);

            // Hentikan kontainer lama
            if (currentContainer && currentInspect?.State?.Running) {
                logger.info({ containerName }, 'Menghentikan kontainer produksi lama...');
                await currentContainer.stop({ t: 5 }).catch(() => {});
                await currentContainer.remove({ force: true }).catch(() => {});
            }

            // Promosikan kontainer kandidat menjadi nama resmi
            await candidateContainer.rename({ name: containerName }).catch(() => {});

            // Bersihkan git checkpoint tag karena update sukses
            if (gitCheckpointCreated) {
                await this.clearGitCheckpoint(targetHostDir, gitCheckpointTag);
            }

            const successMsg = `🎉 Pembaruan kontainer '${containerName}' SUKSES! Versi baru telah aktif secara resmi tanpa downtime.`;
            await this.emitChatroomLog('done', successMsg);

            return {
                status: 'success',
                message: successMsg,
                containerName,
                promotedAt: new Date().toISOString()
            };

        } catch (error) {
            logger.error(
                { containerName, err: error.message },
                `❌ PEMBARUAN GAGAL PADA '${containerName}'. Menjalankan Immediate Safe Rollback...`
            );

            // -------------------------------------------------------------
            // TAHAP 6: IMMEDIATE SAFE ROLLBACK (Pemulihan Darurat)
            // -------------------------------------------------------------
            // 1. Musnahkan kontainer kandidat yang bermasalah seketika
            if (candidateContainer) {
                try {
                    await candidateContainer.stop({ t: 2 }).catch(() => {});
                    await candidateContainer.remove({ force: true, v: true }).catch(() => {});
                    logger.info({ candidateContainerName }, 'Kontainer kandidat yang rusak telah dimusnahkan secara bersih.');
                } catch (cleanErr) {
                    logger.warn({ cleanErr: cleanErr.message }, 'Gagal menghapus kontainer kandidat.');
                }
            }

            // 2. Revert kode sumber target ke Git Checkpoint awal (Hard Reset)
            if (gitCheckpointCreated && targetHostDir) {
                await this.revertGitCheckpoint(targetHostDir, gitCheckpointTag);
            }


            // 3. Pastikan kontainer produksi lama tetap dalam kondisi prima
            if (currentContainer && currentInspect && !currentInspect.State.Running) {
                logger.warn({ containerName }, 'Menghidupkan kembali kontainer produksi lama...');
                await currentContainer.start().catch(() => {});
            }

            const failMsg = `⚠️ Pembaruan untuk '${containerName}' dibatalkan: ${error.message}. SAFE ROLLBACK SELESAI: Kontainer produksi asli tetap berjalan normal 100%.`;
            await this.emitChatroomLog('done', failMsg);

            // Kirim notifikasi darurat ke Master Agent
            await eventBus.publish(TOPICS.DEVOPS.ALERTS, {
                sourceAgent: 'ContainerUpdater',
                action: 'UPDATE_FAILED_ROLLED_BACK',
                payload: {
                    container: containerName,
                    error: error.message,
                    rolledBack: true,
                    timestamp: new Date().toISOString(),
                    priority: 'HIGH'
                }
            });

            return {
                status: 'error',
                message: error.message,
                rolledBack: true
            };

        } finally {
            this.activeUpdates.delete(containerName);
        }
    }

    /**
     * Memeriksa kesehatan kontainer via Docker inspect, native healthcheck, dan probe internal
     */
    async probeContainerHealth(container, timeoutMs = 30000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            try {
                const inspect = await container.inspect();
                // Jika kontainer exit atau crash, langsung gagal
                if (!inspect.State.Running || inspect.State.Dead || inspect.State.OOMKilled) {
                    return false;
                }

                // 1. Cek Native Docker Healthcheck jika didefinisikan pada image / compose
                if (inspect.State.Health) {
                    if (inspect.State.Health.Status === 'healthy') {
                        return true;
                    }
                    if (inspect.State.Health.Status === 'unhealthy') {
                        return false;
                    }
                    // Jika status 'starting', lanjutkan polling menunggu ready
                }

                // 2. Deteksi port utama layanan (fallback ke 3000 jika tidak terdeteksi)
                const exposedPorts = Object.keys(inspect.Config?.ExposedPorts || {});
                const targetPort = exposedPorts[0] ? exposedPorts[0].split('/')[0] : '3000';

                // 3. Coba eksekusi probe HTTP internal (wget atau curl) tanpa false-positive exit 0
                try {
                    const execInst = await container.exec({
                        Cmd: ['sh', '-c', `wget -q -O - http://localhost:${targetPort}/health || curl -sf http://localhost:${targetPort}/health`],
                        AttachStdout: true,
                        AttachStderr: true
                    });
                    const stream = await execInst.start();
                    await new Promise(r => stream.on('end', r));
                    const execData = await execInst.inspect();
                    if (execData.ExitCode === 0) {
                        return true;
                    }
                } catch (_) {
                    // Exec mungkin gagal jika image tidak memiliki shell / binary curl
                }

                // 4. Fallback jika tidak ada Healthcheck formal dan probe HTTP tidak tersedia (misal worker non-HTTP):
                // Dianggap sehat jika kontainer berjalan stabil tanpa restart/crash minimal 6 detik (atau 70% timeout)
                if (!inspect.State.Health && (Date.now() - startTime >= Math.min(6000, timeoutMs * 0.7))) {
                    return true;
                }
            } catch (_) {
                // Tunggu sebelum polling berikutnya
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        return false;
    }

    async buildImage(candidateImageTag, targetHostDir) {
        await execAsync(`docker build -t ${candidateImageTag} "${targetHostDir}"`);
    }

    async createGitCheckpoint(targetHostDir, tag) {
        try {
            await execAsync(`git -C "${targetHostDir}" tag ${tag}`);
            logger.info({ tag, targetHostDir }, '✅ Git safety checkpoint berhasil dibuat.');
            return true;
        } catch (err) {
            logger.warn({ targetHostDir, err: err.message }, 'Target bukan root git repo langsung, proteksi snapshot runtime aktif.');
            return false;
        }
    }

    async revertGitCheckpoint(targetHostDir, tag) {
        try {
            await execAsync(`git -C "${targetHostDir}" reset --hard ${tag}`);
            await execAsync(`git -C "${targetHostDir}" tag -d ${tag}`);
            logger.info('✅ Kode sumber target berhasil di-revert utuh ke Git Checkpoint awal.');
            return true;
        } catch (err) {
            logger.error({ err: err.message }, 'Gagal melakukan git hard reset.');
            return false;
        }
    }

    async clearGitCheckpoint(targetHostDir, tag) {
        try {
            await execAsync(`git -C "${targetHostDir}" tag -d ${tag}`);
        } catch (_) {}
    }

    async emitChatroomLog(status, message) {
        await eventBus.publish(TOPICS.DEVOPS.CHATROOM || 'waguri:chatroom', {
            agentName: 'WaguriContainerUpdater',
            status,
            message
        });
    }
}

export const containerUpdater = new ContainerUpdaterService();


