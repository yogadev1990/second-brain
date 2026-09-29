import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { redisLogger } from '../services/redisLogger.js';

const execAsync = promisify(exec);
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.resolve(process.cwd(), 'workspace');

// Pastikan workspace dir ada
if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

export class Executor {
    /**
     * Jalankan instalasi dependensi (npm atau pip) secara terisolasi di workspace
     */
    static async installDependency({ ecosystem, packages }) {
        if (!ecosystem || !Array.isArray(packages) || packages.length === 0) {
            throw new Error('Parameter ecosystem ("npm"|"pip") dan array packages wajib diisi.');
        }

        // Sanitasi nama package untuk mencegah shell injection
        const sanitizedPackages = packages.map(pkg => pkg.trim()).filter(pkg => /^[a-zA-Z0-9_\-@\.\/]+$/.test(pkg));
        if (sanitizedPackages.length === 0) {
            throw new Error('Tidak ada nama paket yang valid untuk diinstal.');
        }

        const packageList = sanitizedPackages.join(' ');
        await redisLogger.logProgress('working', `Mengunduh dependensi [${ecosystem}]: ${packageList} ke sandbox...`);

        try {
            let cmd = '';
            if (ecosystem.toLowerCase() === 'npm') {
                // Inisialisasi package.json di workspace jika belum ada
                const pkgJsonPath = path.join(WORKSPACE_DIR, 'package.json');
                if (!fs.existsSync(pkgJsonPath)) {
                    fs.writeFileSync(pkgJsonPath, JSON.stringify({ name: 'sandbox-env', version: '1.0.0' }, null, 2));
                }
                cmd = `npm install --prefix "${WORKSPACE_DIR}" ${packageList}`;
            } else if (ecosystem.toLowerCase() === 'pip') {
                // Gunakan venv python jika ada, atau fallback ke pip3
                const venvPip = path.join(WORKSPACE_DIR, '.venv', 'bin', 'pip');
                const pipExecutable = fs.existsSync(venvPip) ? venvPip : 'pip3';
                cmd = `${pipExecutable} install ${packageList}`;
            } else {
                throw new Error(`Ecosystem '${ecosystem}' tidak didukung. Gunakan 'npm' atau 'pip'.`);
            }

            const { stdout, stderr } = await execAsync(cmd, {
                cwd: WORKSPACE_DIR,
                timeout: 120000 // 2 menit timeout
            });

            await redisLogger.logProgress('done', `Dependensi [${ecosystem}] ${packageList} berhasil terpasang di sandbox!`);

            return {
                status: 'success',
                ecosystem,
                installed: sanitizedPackages,
                output: stdout.trim() || stderr.trim()
            };
        } catch (error) {
            await redisLogger.logProgress('error', `Gagal memasang dependensi: ${error.message}`);
            return {
                status: 'error',
                message: error.message,
                stderr: error.stderr || ''
            };
        }
    }

    /**
     * Eksekusi script kode (javascript, python, atau bash)
     */
    static async executeScript({ language, code, timeoutMs = 30000 }) {
        if (!code || typeof code !== 'string') {
            throw new Error('Parameter code wajib berupa string.');
        }

        const allowedTimeout = Math.min(Math.max(timeoutMs, 1000), 120000); // 1s - 120s
        const lang = (language || 'javascript').toLowerCase();

        await redisLogger.logProgress('thinking', `Mempersiapkan eksekusi script [${lang}] di sandbox...`);

        const tempFileName = `exec_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        let filePath = '';
        let cmd = '';

        try {
            if (lang === 'python' || lang === 'py') {
                filePath = path.join(WORKSPACE_DIR, `${tempFileName}.py`);
                fs.writeFileSync(filePath, code, 'utf-8');

                const venvPython = path.join(WORKSPACE_DIR, '.venv', 'bin', 'python3');
                const pyExecutable = fs.existsSync(venvPython) ? venvPython : 'python3';
                cmd = `${pyExecutable} "${filePath}"`;
            } else if (lang === 'javascript' || lang === 'node' || lang === 'js') {
                filePath = path.join(WORKSPACE_DIR, `${tempFileName}.mjs`);
                fs.writeFileSync(filePath, code, 'utf-8');
                cmd = `node "${filePath}"`;
            } else if (lang === 'bash' || lang === 'sh') {
                filePath = path.join(WORKSPACE_DIR, `${tempFileName}.sh`);
                fs.writeFileSync(filePath, code, 'utf-8');
                cmd = `bash "${filePath}"`;
            } else {
                throw new Error(`Bahasa '${lang}' tidak didukung. Pilih 'javascript', 'python', atau 'bash'.`);
            }

            await redisLogger.logProgress('working', `Menjalankan script [${lang}] (timeout: ${allowedTimeout / 1000}s)...`);

            const { stdout, stderr } = await execAsync(cmd, {
                cwd: WORKSPACE_DIR,
                timeout: allowedTimeout,
                maxBuffer: 1024 * 1024 * 5 // 5MB buffer
            });

            await redisLogger.logProgress('done', `Eksekusi script [${lang}] selesai.`);

            return {
                status: 'success',
                language: lang,
                stdout: stdout.trim(),
                stderr: stderr.trim()
            };
        } catch (error) {
            const isTimeout = error.killed && error.signal === 'SIGTERM';
            const errMsg = isTimeout ? `Script timeout melebihi batas ${allowedTimeout / 1000} detik!` : error.message;

            await redisLogger.logProgress('error', `Eksekusi script [${lang}] gagal: ${errMsg}`);

            return {
                status: 'error',
                language: lang,
                message: errMsg,
                stderr: error.stderr || '',
                stdout: error.stdout || ''
            };
        } finally {
            // Bersihkan file sementara
            if (filePath && fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath); } catch (_) {}
            }
        }
    }

    /**
     * Menjelajahi file dalam workspace sandbox
     */
    static async listWorkspaceFiles({ subpath = '' } = {}) {
        const targetPath = path.resolve(WORKSPACE_DIR, subpath);
        if (!targetPath.startsWith(WORKSPACE_DIR)) {
            throw new Error('Akses direktori di luar workspace dilarang.');
        }

        if (!fs.existsSync(targetPath)) {
            return { status: 'error', message: 'Direktori tidak ditemukan.' };
        }

        const entries = fs.readdirSync(targetPath, { withFileTypes: true });
        const files = entries.map(e => ({
            name: e.name,
            isDirectory: e.isDirectory(),
            size: e.isFile() ? fs.statSync(path.join(targetPath, e.name)).size : 0
        }));

        return {
            status: 'success',
            workspace: WORKSPACE_DIR,
            currentPath: targetPath,
            files
        };
    }
}
