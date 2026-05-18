import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export const declaration = {
    name: "restart_container",
    description: "Me-restart container Docker yang spesifik.",
    parameters: {
        type: "object",
        properties: {
            nama_container: {
                type: "string",
                description: "Nama container Docker yang ingin direstart"
            }
        },
        required: ["nama_container"]
    }
};

export async function execute(args) {
    const nama_container = args.nama_container;
    
    if (!nama_container) {
        return { status: "error", message: "Parameter 'nama_container' wajib diisi." };
    }

    try {
        const { stdout, stderr } = await execPromise(`docker restart ${nama_container}`);
        return { status: "success", message: `Container '${nama_container}' berhasil direstart.`, output: stdout.trim() };
    } catch (error) {
        // Tangkap error (misal: container tidak ada) agar tidak membuat server crash
        return { status: "error", message: `Gagal merestart container '${nama_container}': ${error.message}` };
    }
}
