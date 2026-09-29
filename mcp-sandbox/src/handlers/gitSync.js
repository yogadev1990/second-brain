import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { redisLogger } from '../services/redisLogger.js';

const execAsync = promisify(exec);
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.resolve(process.cwd(), 'workspace');
const REPO_DIR = path.join(WORKSPACE_DIR, 'repo');

export class GitSync {
    /**
     * Sinkronisasi repository Git berisi tools ke workspace sandbox
     */
    static async syncRepo({ repoUrl, branch = 'main' } = {}) {
        const targetUrl = repoUrl || process.env.TOOLS_GIT_REPO;
        const targetBranch = branch || process.env.GIT_BRANCH || 'main';

        if (!targetUrl) {
            return {
                status: 'skipped',
                message: 'TOOLS_GIT_REPO belum ditentukan. Melewati sinkronisasi git.'
            };
        }

        await redisLogger.logProgress('working', `Menyinkronkan tools dari Git (${targetUrl}#${targetBranch})...`);

        try {
            if (!fs.existsSync(REPO_DIR)) {
                // Clone pertama kali
                await redisLogger.logProgress('working', `Melakukan git clone repo tools...`);
                await execAsync(`git clone --depth 1 --branch ${targetBranch} "${targetUrl}" "${REPO_DIR}"`, {
                    cwd: WORKSPACE_DIR,
                    timeout: 60000
                });
            } else {
                // Pull perubahan terbaru
                await redisLogger.logProgress('working', `Menarik pembaruan git terbaru (git pull)...`);
                await execAsync(`git fetch origin ${targetBranch} && git reset --hard origin/${targetBranch}`, {
                    cwd: REPO_DIR,
                    timeout: 60000
                });
            }

            // Ambil commit hash terbaru
            const { stdout: commitInfo } = await execAsync(`git log -1 --oneline`, { cwd: REPO_DIR });

            await redisLogger.logProgress('done', `Sinkronisasi Git selesai: ${commitInfo.trim()}`);

            return {
                status: 'success',
                repoUrl: targetUrl,
                branch: targetBranch,
                latestCommit: commitInfo.trim()
            };
        } catch (error) {
            await redisLogger.logProgress('error', `Gagal sinkronisasi Git: ${error.message}`);
            return {
                status: 'error',
                message: error.message
            };
        }
    }

    /**
     * Memeriksa keberadaan folder tools di dalam repo yang sudah di-clone
     */
    static getToolsDirectory() {
        const repoToolsDir = path.join(REPO_DIR, 'tools');
        if (fs.existsSync(repoToolsDir)) return repoToolsDir;

        const workspaceToolsDir = path.join(WORKSPACE_DIR, 'tools');
        if (fs.existsSync(workspaceToolsDir)) return workspaceToolsDir;

        return null;
    }
}
