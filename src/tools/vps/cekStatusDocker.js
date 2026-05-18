import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export const declaration = {
    name: "cek_status_docker",
    description: "Mengecek daftar semua container Docker yang sedang berjalan beserta statusnya.",
    parameters: {
        type: "object",
        properties: {},
        required: []
    }
};

export async function execute(args) {
    try {
        const { stdout, stderr } = await execPromise('docker ps --format "{{.Names}} - {{.Status}}"');
        
        if (stderr) {
            console.warn(`[Peringatan] Docker ps stderr: ${stderr}`);
        }
        
        if (!stdout.trim()) {
            return { status: "success", message: "Tidak ada container Docker yang sedang berjalan." };
        }
        
        return { status: "success", containers: stdout.trim() };
    } catch (error) {
        return { status: "error", message: `Gagal menjalankan docker ps: ${error.message}` };
    }
}
