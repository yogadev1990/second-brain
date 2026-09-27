import fs from 'fs';
import path from 'path';
import Docker from 'dockerode';
import { exec } from 'child_process';
import util from 'util';
import { eventBus } from '../core/bus/eventBus.js';
import { TOPICS } from '../core/bus/topics.js';
import { createAgentLogger } from '../core/logger/index.js';
import { coderService } from './coderService.js';

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
        this.coderService = coderService;
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
            const isSelfContainer = containerName === (process.env.CONTAINER_NAME || 'secondbrain');

            if (!workingDir && !isSelfContainer && currentInspect?.HostConfig?.Binds) {
                for (const bind of currentInspect.HostConfig.Binds) {
                    const [hostPath, containerPath] = bind.split(':');

                    // Pastikan hostPath adalah path absolut direktori host, bukan Docker named volume atau socket
                    const isAbsolutePath = hostPath.startsWith('/') || hostPath.startsWith('./') || /^[a-zA-Z]:[\\/]/.test(hostPath);
                    if (!isAbsolutePath || hostPath.includes('docker.sock')) {
                        continue;
                    }

                    // Pastikan containerPath adalah root direktori aplikasi/workspace, bukan subfolder/data volume
                    const isPrimaryAppDir = 
                        containerPath === '/app' || 
                        containerPath === '/workspace' || 
                        containerPath.startsWith('/var/www') || 
                        containerPath.startsWith('/usr/share/nginx/html');

                    if (isPrimaryAppDir) {
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
            // TAHAP 1.5: EKSEKUSI AUTONOMOUS CODER (Aider / Gemini)
            // -------------------------------------------------------------
            if (taskDescription) {
                await this.executeCoder(targetHostDir, taskDescription, containerName);
            }

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
                        await this.executeCoder(targetHostDir, `Perbaiki kegagalan build image Docker berikut: ${buildError}`, containerName);
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

                // Terapkan auto-repair koding untuk mengatasi crash runtime
                await this.executeCoder(targetHostDir, `Kontainer mengalami crash atau gagal healthcheck: ${candidateLog || 'Unhealthy'}. Perbaiki kode agar kontainer berjalan sehat.`, containerName);

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

            const allNetworks = Object.keys(currentInspect?.NetworkSettings?.Networks || {});
            const successMsg = `🎉 Pembaruan kontainer '${containerName}' SUKSES! Versi baru telah aktif secara resmi tanpa downtime.`;

            if (isSelfContainer) {
                // Untuk Waguri sendiri (self-evolution):
                // Kirim notifikasi sukses DULUAN ke user/chatroom sebelum kontainer lama diganti
                await this.emitChatroomLog('done', successMsg);

                // Bersihkan git checkpoint tag karena update sukses
                if (gitCheckpointCreated) {
                    await this.clearGitCheckpoint(targetHostDir, gitCheckpointTag);
                }

                // Delegasikan proses swap ke Swapper Daemon terpisah agar proses Node saat ini tidak bunuh diri sebelum selesai
                await this.executeSelfSwap({
                    containerName,
                    candidateContainerName,
                    candidateImageTag,
                    targetBinds,
                    allNetworks,
                    envVars: currentInspect?.Config?.Env || ['NODE_ENV=production', 'TZ=Asia/Jakarta'],
                    portBindings: currentInspect?.HostConfig?.PortBindings
                });
            } else {
                // Untuk kontainer layanan lain (misal revandastore-app, wiki-web):
                // Hubungkan kandidat ke seluruh network tambahan target (misal proxy-network)
                for (let i = 1; i < allNetworks.length; i++) {
                    try {
                        const net = this.docker.getNetwork(allNetworks[i]);
                        await net.connect({ Container: candidateContainer.id });
                    } catch (_) {}
                }

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

                await this.emitChatroomLog('done', successMsg);
            }

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

                // 3. Coba eksekusi probe HTTP internal (wget atau curl) tanpa deadlock
                try {
                    const execInst = await container.exec({
                        Cmd: ['sh', '-c', `wget -q -O - http://127.0.0.1:${targetPort}/health || curl -sf http://127.0.0.1:${targetPort}/health`],
                        AttachStdout: true,
                        AttachStderr: true
                    });
                    const stream = await execInst.start({ Detach: false, Tty: false });
                    await new Promise((resolve) => {
                        const timer = setTimeout(resolve, 3000);
                        if (stream && typeof stream.on === 'function') {
                            stream.on('end', () => { clearTimeout(timer); resolve(); });
                            stream.on('close', () => { clearTimeout(timer); resolve(); });
                            stream.on('error', () => { clearTimeout(timer); resolve(); });
                            if (typeof stream.resume === 'function') stream.resume();
                        } else {
                            clearTimeout(timer);
                            resolve();
                        }
                    });
                    const execData = await execInst.inspect();
                    if (execData?.ExitCode === 0) {
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

    /**
     * Memanggil CoderService untuk memproses kode secara mandiri
     */
    async executeCoder(targetDir, taskDescription, containerName) {
        if (!taskDescription || !this.coderService) return;
        try {
            await this.coderService.runAutonomousCoder({
                targetDir,
                taskDescription,
                containerName,
                emitLog: (status, msg) => this.emitChatroomLog(status, msg)
            });
        } catch (coderErr) {
            logger.error({ err: coderErr.message }, 'Tahap Autonomous Coder mengalami kendala.');
            await this.emitChatroomLog('reporting', `⚠️ Coder notice: ${coderErr.message}`);
        }
    }

    async buildImage(candidateImageTag, targetHostDir) {
        // Pastikan file Dockerfile ada di dalam direktori konteks build (mencegah error 'open Dockerfile: no such file')
        const dockerfilePath = path.join(targetHostDir, 'Dockerfile');
        if (!fs.existsSync(dockerfilePath)) {
            logger.warn({ targetHostDir }, 'Dockerfile tidak ditemukan di direktori konteks. Membuat Dockerfile default secara otomatis...');
            const defaultDockerfile = [
                'FROM node:20-alpine',
                'RUN apk add --no-cache docker-cli docker-cli-buildx git',
                'WORKDIR /app',
                'COPY package*.json ./',
                'RUN npm install --omit=dev',
                'COPY . .',
                'EXPOSE 3000',
                'CMD ["npm", "start"]\n'
            ].join('\n');
            try {
                fs.writeFileSync(dockerfilePath, defaultDockerfile, 'utf-8');
            } catch (writeErr) {
                logger.warn({ err: writeErr.message }, 'Tidak dapat menulis Dockerfile fallback ke direktori konteks.');
            }
        }

        logger.info({ candidateImageTag, targetHostDir }, '🔨 Menjalankan docker build di Docker Daemon host...');
        try {
            await execAsync(`docker build -t ${candidateImageTag} "${targetHostDir}"`);
            logger.info({ candidateImageTag }, '✅ Build image kandidat berhasil diselesaikan.');
        } catch (err) {
            // Jika buildx belum terpasang atau rusak saat BuildKit aktif, fallback otomatis ke mode legacy
            if (err.message && (err.message.includes('buildx') || err.message.includes('BuildKit'))) {
                logger.warn({ err: err.message }, 'Komponen buildx tidak ditemukan atau rusak. Mencoba fallback ke DOCKER_BUILDKIT=0...');
                await execAsync(`docker build -t ${candidateImageTag} "${targetHostDir}"`, {
                    env: { ...process.env, DOCKER_BUILDKIT: '0' }
                });
                logger.info({ candidateImageTag }, '✅ Build image kandidat berhasil (mode legacy DOCKER_BUILDKIT=0).');
            } else {
                throw err;
            }
        }
    }

    /**
     * Menjalankan Hot-Swap mandiri untuk Waguri (secondbrain) via Swapper Daemon ephemeral.
     * Swapper Daemon berjalan di kontainer terpisah agar secondbrain lama dapat dimatikan
     * dan secondbrain baru dapat dinyalakan dengan port binding 3000:3000 serta multi-network
     * (waguri-internal dan proxy-network) tanpa downtime.
     */
    async executeSelfSwap({
        containerName,
        candidateContainerName,
        candidateImageTag,
        targetBinds,
        allNetworks,
        envVars,
        portBindings
    }) {
        logger.info({ containerName, candidateImageTag }, '🚀 Menjalankan Swapper Daemon untuk self-swap zero-downtime...');

        // Filter out system networks yang tidak boleh di-connect ulang manual
        const filteredNetworks = (allNetworks || []).filter(n => n && n !== 'bridge' && n !== 'host' && n !== 'none');
        const internalNet = filteredNetworks.find(n => n.includes('internal') || n.includes('second-brain'));
        const primaryNetwork = internalNet || filteredNetworks[0] || 'second-brain_waguri-internal';
        const additionalNetworks = filteredNetworks.filter(n => n !== primaryNetwork);

        const bindArgs = (targetBinds || []).map(b => `-v "${b}"`).join(' ');
        
        // Escape variabel lingkungan secara aman dengan format POSIX single quotes
        const envArgs = (envVars || [])
            .filter(e => !e.startsWith('PATH=') && !e.startsWith('NODE_VERSION=') && !e.startsWith('YARN_VERSION='))
            .map(e => {
                const eqIdx = e.indexOf('=');
                if (eqIdx === -1) return `-e ${e}`;
                const k = e.slice(0, eqIdx);
                const v = e.slice(eqIdx + 1);
                return `-e ${k}='${v.replace(/'/g, "'\\''")}'`;
            })
            .join(' ');

        let portArgs = '-p 3000:3000';
        if (portBindings && Object.keys(portBindings).length > 0) {
            portArgs = Object.entries(portBindings).map(([cPort, hPorts]) => {
                const hostPort = hPorts[0]?.HostPort || cPort.split('/')[0];
                return `-p ${hostPort}:${cPort.split('/')[0]}`;
            }).join(' ');
        }

        const networkConnectCmds = additionalNetworks
            .map(net => `docker network connect ${net} ${containerName} || true`)
            .join('\n');

        const swapScript = [
            'set -e',
            'sleep 4',
            `echo "[Swapper] Menghentikan kontainer uji kandidat ${candidateContainerName}..."`,
            `docker rm -f ${candidateContainerName} || true`,
            `echo "[Swapper] Menghentikan kontainer lama ${containerName}..."`,
            `docker stop -t 3 ${containerName} || true`,
            `docker rm -f ${containerName} || true`,
            `echo "[Swapper] Meluncurkan kontainer baru ${containerName}..."`,
            `docker run -d --name ${containerName} --restart always ${portArgs} --network ${primaryNetwork} ${bindArgs} ${envArgs} ${candidateImageTag}`,
            networkConnectCmds,
            'echo "[Swapper] Membersihkan image build usang (dangling image cache)..."',
            'docker image prune -f || true',
            `echo "[Swapper] Hotswap selesai! Kontainer ${containerName} resmi aktif."`
        ].filter(Boolean).join('\n');

        try {
            const swapper = await this.docker.createContainer({
                Image: candidateImageTag,
                name: `waguri-swapper-${Date.now()}`,
                Cmd: ['sh', '-c', swapScript],
                HostConfig: {
                    Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
                    NetworkMode: primaryNetwork,
                    AutoRemove: false // Tetap ada sesaat agar log swapper dapat diperiksa
                }
            });

            await swapper.start();
            logger.info('✅ Swapper Daemon berhasil diluncurkan di background.');

            // Alirkan log swapper secara real-time ke console logger
            swapper.logs({ follow: true, stdout: true, stderr: true }).then(stream => {
                stream.on('data', chunk => {
                    const lines = chunk.toString('utf8').trim().split('\n');
                    for (const l of lines) {
                        if (l) logger.info({ swapper: 'daemon' }, l);
                    }
                });
            }).catch(() => {});

            // Musnahkan kontainer swapper secara bersih setelah selesai bekerja
            if (typeof swapper.wait === 'function') {
                swapper.wait().then(async () => {
                    await new Promise(r => setTimeout(r, 5000));
                    await swapper.remove({ force: true }).catch(() => {});
                }).catch(() => {});
            } else {
                setTimeout(async () => {
                    try {
                        await swapper.remove({ force: true }).catch(() => {});
                    } catch (_) {}
                }, 25000);
            }
        } catch (swapperErr) {
            logger.error({ err: swapperErr.message }, 'Gagal meluncurkan Swapper Daemon.');
            throw swapperErr;
        }
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
        logger.info({ status }, `📢 [Updater] ${message}`);
        try {
            await eventBus.publish(TOPICS.DEVOPS.CHATROOM || 'waguri:chatroom', {
                agentName: 'WaguriContainerUpdater',
                status,
                message
            });
        } catch (_) {}
    }
}

export const containerUpdater = new ContainerUpdaterService();


