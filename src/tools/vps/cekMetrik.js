import os from 'os';

// 1. Objek Declaration (Skema JSON untuk dikirim ke Gemini)
export const declaration = {
    name: "cek_metrik_vps",
    description: "Mengecek status metrik server VPS saat ini, termasuk penggunaan RAM dan Uptime server.",
    parameters: {
        type: "object",
        properties: {},
        // Tidak ada parameter yang wajib diisi untuk fungsi ini
        required: []
    }
};

// 2. Fungsi Execute (Logika asli Node.js untuk mengeksekusi perintah)
export async function execute(args) {
    try {
        const totalMemory = os.totalmem() / (1024 * 1024 * 1024);
        const freeMemory = os.freemem() / (1024 * 1024 * 1024);
        const usedMemory = totalMemory - freeMemory;
        
        const uptimeSeconds = os.uptime();
        const days = Math.floor(uptimeSeconds / (3600 * 24));
        const hours = Math.floor((uptimeSeconds % (3600 * 24)) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);

        const metrik = {
            ram_total_gb: parseFloat(totalMemory.toFixed(2)),
            ram_used_gb: parseFloat(usedMemory.toFixed(2)),
            ram_free_gb: parseFloat(freeMemory.toFixed(2)),
            uptime_text: `${days} hari, ${hours} jam, ${minutes} menit`,
            status: usedMemory / totalMemory > 0.9 ? "Kritis" : "Aman"
        };

        return metrik;
    } catch (error) {
        throw new Error(`Gagal membaca metrik VPS: ${error.message}`);
    }
}
