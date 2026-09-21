import { executeHybridRRFSearch } from '../../agents/archivist/hybridSearch.js';

export const declaration = {
    name: "cari_ingatan_hybrid",
    description: "Mencari ingatan masa lalu, fakta, catatan, atau istilah teknis/medis menggunakan pencarian Hybrid RRF (kombinasi Vector Semantik dan Kata Kunci Teks).",
    parameters: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "Kalimat pertanyaan, kata kunci, atau topik ingatan yang ingin dicari."
            },
            limit: {
                type: "number",
                description: "Jumlah hasil ingatan teratas (opsional, default: 5)."
            }
        },
        required: ["query"]
    }
};

export async function execute(args) {
    const { query, limit } = args;

    if (!query) {
        return { status: "error", message: "Parameter 'query' wajib diisi." };
    }

    try {
        const results = await executeHybridRRFSearch(query, limit || 5);
        if (!results || results.length === 0) {
            return { status: "success", hasil: "Tidak ada ingatan atau catatan yang relevan ditemukan." };
        }

        let combined = "Hasil pencarian ingatan (Hybrid RRF Fusion):\n";
        results.forEach((item, idx) => {
            combined += `${idx + 1}. [Kategori: ${item.category || 'General'}] (Skor: ${item.score.toFixed(4)}, Sumber: ${item.source})\nIsi: ${item.content}\n\n`;
        });

        return { status: "success", hasil: combined };
    } catch (error) {
        return { status: "error", message: `Gagal mencari ingatan: ${error.message}` };
    }
}
