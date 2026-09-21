import { eventBus } from '../../core/bus/eventBus.js';
import { TOPICS } from '../../core/bus/topics.js';

export const declaration = {
    name: "kontrol_perangkat_kamar",
    description: "Mengendalikan perangkat fisik di kamar pengguna (Lampu meja USB dan Layar Meja AMOLED ESP32-S3).",
    parameters: {
        type: "object",
        properties: {
            perangkat: {
                type: "string",
                description: "Perangkat yang ingin dikontrol: 'lampu_usb' atau 'desk_display'."
            },
            aksi: {
                type: "string",
                description: "Aksi yang diinginkan: 'ON', 'OFF', atau 'UPDATE'."
            },
            pesan_layar: {
                type: "string",
                description: "Teks atau pesan yang ingin ditampilkan di layar AMOLED jika perangkat adalah 'desk_display'."
            }
        },
        required: ["perangkat", "aksi"]
    }
};

export async function execute(args) {
    const { perangkat, aksi, pesan_layar } = args;

    try {
        await eventBus.publish(TOPICS.IOT.COMMAND, {
            sourceAgent: 'GeminiTool',
            action: aksi,
            payload: {
                device: perangkat,
                action: aksi,
                value: {
                    title: 'WAGURI IOT',
                    body: pesan_layar || `Perangkat ${perangkat} disetel ke ${aksi}`,
                    icon: perangkat === 'lampu_usb' ? 'lamp' : 'heart'
                }
            }
        });

        return {
            status: "success",
            message: `Perintah '${aksi}' untuk perangkat '${perangkat}' berhasil dikirim ke IoT Gateway ESP32-S3.`
        };
    } catch (error) {
        return {
            status: "error",
            message: `Gagal mengirim perintah ke IoT Gateway: ${error.message}`
        };
    }
}
