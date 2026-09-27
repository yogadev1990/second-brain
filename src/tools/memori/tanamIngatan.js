import { GoogleGenAI } from '@google/genai';
import { mongoMemoryService } from '../../services/mongoMemoryService.js';

export const declaration = {
    name: "tanam_ingatan",
    description: "Gunakan alat ini HANYA untuk menyimpan pengetahuan abstrak, informasi statis, ide proyek, catatan riset, atau memori umum. DILARANG KERAS menggunakan alat ini untuk menyimpan jadwal, rutinitas harian, target waktu, atau janji temu. Jika input berkaitan dengan waktu, rutinitas, atau jadwal, abaikan alat ini dan panggil 'tambah_jadwal'.",
    parameters: {
        type: "object",
        properties: {
            teks_mentah: {
                type: "string",
                description: "Teks atau informasi yang ingin disimpan ke dalam memori jangka panjang.",
            },
        },
        required: ["teks_mentah"],
    },
};

export async function execute(args) {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const { teks_mentah } = args;

    if (!teks_mentah) {
        return { status: "error", message: "Parameter teks_mentah wajib diisi." };
    }

    try {
        // Tahap 1: Auto-Tagging Kategori & Tags via Gemini Flash
        const promptTagging = `Ekstrak teks berikut ke dalam JSON murni yang berisi 'kategori' (pilih satu: Jurnal, Proyek, Log_Aktivitas, Ide, Fakta_Pribadi, Umum) dan 'tags' (array 3 kata kunci). Jangan berikan teks lain. Teks: ${teks_mentah}`;
        
        const taggingResult = await ai.models.generateContent({
            model: 'gemini-flash-latest',
            contents: promptTagging,
            config: {
                responseMimeType: "application/json",
            }
        });
        
        let kategori = "Umum";
        let tags = [];
        try {
            const taggingJson = JSON.parse(taggingResult.text);
            kategori = taggingJson.kategori || "Umum";
            tags = taggingJson.tags || [];
        } catch (_) {}

        // Tahap 2: Tanam ke MongoDB Vector Database via mongoMemoryService
        const doc = await mongoMemoryService.tanamIngatan({
            content: teks_mentah,
            category: kategori,
            tags: tags,
            metadata: { source: 'user_chat' }
        });

        return {
            status: "success",
            message: "Ingatan berhasil ditanam ke MongoDB Vector Database.",
            docId: doc.docId,
            kategori: kategori,
            tags: tags
        };

    } catch (error) {
        console.error("[tanam_ingatan] Error:", error);
        return {
            status: "error",
            message: `Gagal menanam ingatan: ${error.message}`
        };
    }
}