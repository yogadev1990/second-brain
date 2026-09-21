import Docker from 'dockerode';

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

    // Proteksi keamanan: Validasi nama container
    if (!/^[a-zA-Z0-9_.-]+$/.test(nama_container)) {
        return { status: "error", message: "Nama container mengandung karakter tidak sah." };
    }

    try {
        const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock' });
        const container = docker.getContainer(nama_container);
        
        const logsBuffer = await container.logs({
            stdout: true,
            stderr: true,
            tail: 50
        });

        const logString = logsBuffer ? logsBuffer.toString('utf-8').trim() : '';

        if (!logString) {
            return { status: "success", log: `Log container '${nama_container}' kosong.` };
        }

        return { status: "success", log: logString };
    } catch (error) {
        return { status: "error", message: `Gagal membaca log container '${nama_container}': ${error.message}` };
    }
}
