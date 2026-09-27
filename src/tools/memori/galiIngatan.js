import { mongoMemoryService } from '../../services/mongoMemoryService.js';

export const declaration = {
    name: "gali_ingatan",
    description: "Mencari ingatan masa lalu, fakta, preferensi, atau riwayat catatan dari memori jangka panjang MongoDB menggunakan pencarian semantik vektor.",
    parameters: {
        type: "object",
        properties: {
            kata_kunci: {
                type: "string",
                description: "Kata kunci, pertanyaan, atau deskripsi memori yang ingin dicari.",
            },
            filter_kategori: {
                type: "string",
                description: "Filter opsional berdasarkan kategori (Jurnal, Proyek, Log_Aktivitas, Ide, Fakta_Pribadi, Umum). Biarkan kosong jika ingin mencari semua.",
                nullable: true,
            },
        },
        required: ["kata_kunci"],
    },
};

export async function execute(args) {
    const { kata_kunci, filter_kategori } = args;

    if (!kata_kunci) {
        return { status: "error", message: "Parameter kata_kunci wajib diisi." };
    }

    try {
        const category = filter_kategori && filter_kategori.trim() !== "" ? filter_kategori.trim() : undefined;
        
        // Pencarian Vektor Semantik langsung di MongoDB
        const results = await mongoMemoryService.searchVector(kata_kunci, { category, limit: 5 });

        if (!results || results.length === 0) {
            return { hasil: "Tidak ada ingatan yang relevan ditemukan di database." };
        }

        let combinedText = "Hasil pencarian ingatan (MongoDB Vector Search):\n";
        results.forEach((item, index) => {
            const tagString = item.tags && item.tags.length > 0 ? ` [Tags: ${item.tags.join(', ')}]` : '';
            combinedText += `${index + 1}. [Kategori: ${item.category}]${tagString} (Skor Kemiripan: ${(item.score * 100).toFixed(1)}%)\nIsi: ${item.content}\n\n`;
        });

        return { hasil: combinedText };

    } catch (error) {
        console.error("[gali_ingatan] Error:", error);
        return {
            status: "error",
            message: `Gagal menggali ingatan: ${error.message}`
        };
    }
}