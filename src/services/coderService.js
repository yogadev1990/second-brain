import fs from 'fs';
import path from 'path';
import Docker from 'dockerode';
import { GoogleGenAI } from '@google/genai';
import { exec } from 'child_process';
import util from 'util';
import { createAgentLogger } from '../core/logger/index.js';

const logger = createAgentLogger('CoderService');
const execAsync = util.promisify(exec);

export class CoderService {
    constructor() {
        this.docker = new Docker({ socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock' });
        this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
    }

    /**
     * Menjalankan Autonomous Coder untuk memodifikasi kode sumber pada targetDir sesuai taskDescription.
     * Menggunakan strategi Aider Container sebagai prioritas utama dan Direct Gemini Synthesizer sebagai fallback.
     *
     * @param {Object} options
     * @param {string} options.targetDir - Path direktori kode sumber yang akan diedit
     * @param {string} options.taskDescription - Instruksi koding dari pengguna
     * @param {string} [options.containerName] - Nama kontainer target (misal: 'secondbrain')
     * @param {Function} [options.emitLog] - Callback untuk memancarkan log status ke chatroom
     * @returns {Promise<{ success: boolean, method: 'aider'|'gemini_fallback', message: string }>}
     */
    async runAutonomousCoder({ targetDir, taskDescription, containerName = 'secondbrain', emitLog = async () => {} }) {
        if (!targetDir || !fs.existsSync(targetDir)) {
            throw new Error(`Direktori target tidak valid atau tidak ditemukan: ${targetDir}`);
        }

        if (!taskDescription || typeof taskDescription !== 'string') {
            throw new Error("Parameter 'taskDescription' wajib disertakan untuk Coder Agent.");
        }

        logger.info({ targetDir, taskDescription, containerName }, 'Memulai Autonomous Coder...');
        await emitLog('thinking', `Coder Engine menganalisis tugas: "${taskDescription}"`);

        // Coba jalankan via Aider jika Docker daemon aktif dan Aider diaktifkan
        const useAider = process.env.ENABLE_AIDER !== 'false';
        if (useAider) {
            try {
                const aiderResult = await this.runAiderContainer({ targetDir, taskDescription, emitLog });
                if (aiderResult.success) {
                    await emitLog('done', `Aider berhasil menerapkan perubahan kode untuk: "${taskDescription}"`);
                    return { success: true, method: 'aider', message: aiderResult.message };
                }
            } catch (aiderErr) {
                logger.warn({ err: aiderErr.message }, 'Aider container gagal atau tidak tersedia. Beralih ke Direct Gemini Synthesizer...');
                await emitLog('working', `Aider tidak tersedia (${aiderErr.message}). Mengaktifkan Fallback Gemini Synthesizer...`);
            }
        }

        // Fallback: Direct Gemini Synthesizer
        try {
            const synthResult = await this.runDirectGeminiSynthesizer({ targetDir, taskDescription, emitLog });
            await emitLog('done', `Gemini Synthesizer berhasil menerapkan perubahan kode: "${taskDescription}"`);
            return { success: true, method: 'gemini_fallback', message: synthResult.message };
        } catch (synthErr) {
            logger.error({ err: synthErr.message }, 'Direct Gemini Synthesizer gagal menerapkan perubahan kode.');
            throw new Error(`Autonomous Coder gagal menyelesaikan tugas: ${synthErr.message}`);
        }
    }

    /**
     * Menjalankan Aider via Docker container terisolasi (tanpa Docker socket access)
     */
    async runAiderContainer({ targetDir, taskDescription, emitLog }) {
        const aiderImage = process.env.AIDER_IMAGE || 'paulgauthier/aider:latest';
        const aiderModel = process.env.AIDER_MODEL || 'gemini/gemini-2.5-flash';
        const ephemeralName = `aider-coder-${Date.now()}`;

        // Periksa apakah Docker daemon merespons
        await this.docker.ping().catch(() => {
            throw new Error('Docker daemon tidak aktif atau socket tidak dapat diakses.');
        });

        // Pastikan image Aider tersedia (jika belum, beri log)
        await emitLog('working', `Menyiapkan image AI Coder (${aiderImage})...`);
        
        let container = null;
        try {
            container = await this.docker.createContainer({
                Image: aiderImage,
                name: ephemeralName,
                WorkingDir: '/app',
                Env: [
                    `GEMINI_API_KEY=${process.env.GEMINI_API_KEY || ''}`,
                    `AIDER_ANALYTICS=false`,
                    `AIDER_CHECK_UPDATE=false`
                ],
                Cmd: [
                    '--model', aiderModel,
                    '--message', taskDescription,
                    '--yes-always',
                    '--no-check-update',
                    '--no-git-commit-prompt',
                    '--no-show-release-notes'
                ],
                HostConfig: {
                    // Isolasi ketat: Hanya mount folder project target, TANPA docker.sock
                    Binds: [`${targetDir}:/app:rw`],
                    Memory: 1536 * 1024 * 1024, // 1.5 GB RAM
                    NanoCpus: 2000000000,       // 2 CPU
                    AutoRemove: false
                }
            });

            await container.start();
            await emitLog('working', `Aider container '${ephemeralName}' aktif. Menulis dan menguji kode...`);

            // Attach log stream dari container
            const stream = await container.logs({
                follow: true,
                stdout: true,
                stderr: true
            });

            let logBuffer = '';
            stream.on('data', chunk => {
                const text = chunk.toString('utf8');
                logBuffer += text;
                const lines = text.split('\n').filter(l => l.trim().length > 0);
                for (const line of lines.slice(-2)) {
                    if (line.length > 5 && !line.includes('token') && !line.includes('API_KEY')) {
                        emitLog('working', `Aider: ${line.trim().slice(0, 100)}`).catch(() => {});
                    }
                }
            });

            // Tunggu container selesai dengan batas waktu maksimal 5 menit
            const waitResult = await Promise.race([
                container.wait(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Aider execution timeout (> 5 menit)')), 300000))
            ]);

            const exitCode = waitResult?.StatusCode ?? 0;
            if (exitCode !== 0) {
                throw new Error(`Aider selesai dengan Exit Code ${exitCode}. Cuplikan log: ${logBuffer.slice(-300)}`);
            }

            return {
                success: true,
                message: `Aider berhasil memodifikasi kode. Log ringkas: ${logBuffer.slice(-200)}`
            };
        } finally {
            // Pembersihan kontainer ephemeral
            if (container) {
                try {
                    await container.stop({ t: 2 }).catch(() => {});
                    await container.remove({ force: true }).catch(() => {});
                } catch (_) {}
            }
        }
    }

    /**
     * Fallback Direct Gemini Synthesizer:
     * Menggunakan SDK @google/genai untuk menyusun/memodifikasi file kode secara mandiri.
     */
    async runDirectGeminiSynthesizer({ targetDir, taskDescription, emitLog }) {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY tidak dikonfigurasi di environment.');
        }

        await emitLog('working', 'Gemini Synthesizer menyusun rencana arsitektur file...');

        // Baca struktur direktori src jika ada
        const srcDir = path.join(targetDir, 'src');
        let fileStructure = '';
        try {
            if (fs.existsSync(srcDir)) {
                const listFiles = (dir, depth = 0) => {
                    if (depth > 3) return [];
                    const items = fs.readdirSync(dir, { withFileTypes: true });
                    let res = [];
                    for (const item of items) {
                        if (item.name.startsWith('.') || item.name === 'node_modules') continue;
                        const full = path.join(dir, item.name);
                        const rel = path.relative(targetDir, full).replace(/\\/g, '/');
                        if (item.isDirectory()) {
                            res.push(`${rel}/`);
                            res.push(...listFiles(full, depth + 1));
                        } else if (item.name.endsWith('.js') || item.name.endsWith('.json')) {
                            res.push(rel);
                        }
                    }
                    return res;
                };
                fileStructure = listFiles(srcDir).join('\n');
            }
        } catch (_) {}

        // Baca src/tools/index.js jika ada untuk referensi registrasi tool
        let toolsIndexContent = '';
        const toolsIndexPath = path.join(targetDir, 'src', 'tools', 'index.js');
        if (fs.existsSync(toolsIndexPath)) {
            toolsIndexContent = fs.readFileSync(toolsIndexPath, 'utf-8');
        }

        const prompt = `Kamu adalah Autonomous Senior Software Engineer di sistem Waguri Second Brain.
Tugasmu adalah memenuhi instruksi teknis berikut dengan memodifikasi atau membuat file baru:
"${taskDescription}"

Struktur file yang ada saat ini di proyek:
${fileStructure || 'Tidak ada struktur file yang terdeteksi'}

Referensi src/tools/index.js saat ini:
\`\`\`javascript
${toolsIndexContent.slice(0, 2000)}
\`\`\`

Instruksi format respon:
Kembalikan respon HANYA dalam format JSON valid (tanpa markdown tambahan di luar JSON) berupa array perubahan file:
[
  {
    "filePath": "src/tools/eksternal/contoh.js",
    "action": "create", // atau "update"
    "content": "isi kode lengkap file di sini..."
  }
]
Perhatikan:
1. Kode HARUS valid ES Modules (menggunakan 'import' dan 'export', bukan 'require').
2. Jika menambahkan tool baru di 'src/tools/...', pastikan juga mengupdate 'src/tools/index.js' agar tool tersebut di-export di 'toolDeclarations' dan 'toolHandlers'.
3. Sertakan kode secara LENGKAP tanpa elipsis (...) atau placeholder.`;

        const response = await this.ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                temperature: 0.1,
                responseMimeType: 'application/json'
            }
        });

        const replyText = response.text || '';
        let fileChanges = [];
        try {
            fileChanges = JSON.parse(replyText);
        } catch (jsonErr) {
            // Bersihkan markdown blok ```json jika ada
            const cleanJson = replyText.replace(/```json/g, '').replace(/```/g, '').trim();
            fileChanges = JSON.parse(cleanJson);
        }

        if (!Array.isArray(fileChanges) || fileChanges.length === 0) {
            throw new Error('Gemini Synthesizer tidak menghasilkan daftar perubahan file yang valid.');
        }

        for (const change of fileChanges) {
            const { filePath, content } = change;
            if (!filePath || !content) continue;

            const absolutePath = path.resolve(targetDir, filePath);
            // Keamanan: Pastikan path tidak keluar dari targetDir
            if (!absolutePath.startsWith(path.resolve(targetDir))) {
                throw new Error(`Path file tidak aman: ${filePath}`);
            }

            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
            fs.writeFileSync(absolutePath, content, 'utf-8');
            logger.info({ filePath, targetDir }, 'File berhasil ditulis oleh Gemini Synthesizer.');
            await emitLog('working', `Menulis file '${filePath}'...`);
        }

        // Buat Git commit jika targetDir adalah git repository
        try {
            await execAsync(`git -C "${targetDir}" add .`);
            await execAsync(`git -C "${targetDir}" commit -m "feat(ai-coder): ${taskDescription.replace(/"/g, "'")}"`);
            logger.info({ targetDir }, 'Git commit berhasil dibuat untuk perubahan kode.');
        } catch (_) {
            // Bukan git repo atau tidak ada perubahan yang di-stage, tidak masalah
        }

        return {
            success: true,
            message: `${fileChanges.length} file berhasil dimodifikasi/dibuat oleh Gemini Synthesizer.`
        };
    }
}

export const coderService = new CoderService();
