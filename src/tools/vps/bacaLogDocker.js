import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export const declaration = {
    name: "baca_log_docker",
    description: "Membaca 50 baris terakhir dari log sebuah container Docker untuk mendiagnosis error atau aktivitas.",
    parameters: {
        type: "object",
        properties: {
            nama_container: {
                type: "string",
                description: "Nama container Docker yang ingin dibaca log-nya"
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
        // Pada perintah `docker logs`, informasi output dan pesan error bisa bercampur dan seringkali masuk ke stderr.
        const { stdout, stderr } = await execPromise(`docker logs --tail 50 ${nama_container}`);
        
        // Menggabungkan stdout dan stderr untuk ditangkap dengan aman
        const output = [];
        if (stdout) output.push(stdout.trim());
        if (stderr) output.push(stderr.trim());
        
        const finalOutput = output.join('\n\n').trim();
        
        if (!finalOutput) {
            return { status: "success", log: `Log container '${nama_container}' kosong.` };
        }
        
        return { status: "success", log: finalOutput };
    } catch (error) {
        // Tangkap error saat container tidak ditemukan atau exec error lainnya
        return { status: "error", message: `Gagal membaca log container '${nama_container}': ${error.message}` };
    }
}
