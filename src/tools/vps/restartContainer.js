import Docker from 'dockerode';

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

    // Proteksi keamanan: Validasi nama container agar aman dari injeksi
    if (!/^[a-zA-Z0-9_.-]+$/.test(nama_container)) {
        return { status: "error", message: "Nama container mengandung karakter tidak sah." };
    }

    try {
        const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock' });
        const container = docker.getContainer(nama_container);
        await container.restart();
        return { 
            status: "success", 
            message: `Container '${nama_container}' berhasil direstart dengan aman via Docker API.` 
        };
    } catch (error) {
        return { status: "error", message: `Gagal merestart container '${nama_container}': ${error.message}` };
    }
}
