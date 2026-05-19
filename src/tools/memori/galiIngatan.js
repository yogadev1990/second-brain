import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { GoogleGenAI } from '@google/genai';

let milvusAddress = null;

export const declaration = {
    name: "gali_ingatan",
    description: "Mencari ingatan masa lalu, fakta, atau jurnal dari memori jangka panjang.",
    parameters: {
        type: "object",
        properties: {
            kata_kunci: {
                type: "string",
                description: "Kata kunci, pertanyaan, atau deskripsi memori yang ingin dicari.",
            },
            filter_kategori: {
                type: "string",
                description: "Filter opsional berdasarkan kategori (Jurnal, Proyek, Log_Aktivitas, Ide, Fakta_Pribadi). Biarkan kosong jika ingin mencari semua.",
                nullable: true,
            },
        },
        required: ["kata_kunci"],
    },
};

export async function execute(args) {
    // Inisialisasi SDK Baru
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    if (!milvusAddress) {
        milvusAddress = process.env.MILVUS_ADDRESS || `${process.env.MILVUS_HOST}:${process.env.MILVUS_PORT}`;
    }

    const { kata_kunci, filter_kategori } = args;

    if (!kata_kunci) {
        return { status: "error", message: "Parameter kata_kunci wajib diisi." };
    }

    try {
        // Tahap 1: Embedding kata_kunci dengan Task Type Khusus Query
        const embedResponse = await ai.models.embedContent({
            model: 'gemini-embedding-001',
            contents: kata_kunci,
            config: { 
                outputDimensionality: 768,
                taskType: 'RETRIEVAL_QUERY' // Mutlak wajib agar cocok dengan RETRIEVAL_DOCUMENT di fungsi tanam
            },
        });
        
        const searchVector = embedResponse.embeddings[0].values;

        // Tahap 2: Lakukan vector search ke Milvus
        const milvusClient = new MilvusClient({ address: milvusAddress });
        
        let expr = undefined;
        if (filter_kategori && filter_kategori.trim() !== "") {
            expr = `kategori == '${filter_kategori}'`;
        }

        const searchRes = await milvusClient.search({
            collection_name: "Memori_Waguri",
            vector: searchVector,
            filter: expr,
            output_fields: ["teks_asli", "kategori", "tags"],
            limit: 5,
        });

        await milvusClient.closeConnection();

        if (!searchRes.results || searchRes.results.length === 0) {
            return { hasil: "Tidak ada ingatan yang relevan ditemukan." }; // BENAR
        }

        // Tahap 3: Rangkai teks_asli dari hasil pencarian agar mudah dibaca AI
        let combinedText = "Hasil pencarian ingatan:\n";
        searchRes.results.forEach((item, index) => {
            const tagString = item.tags ? `[Tags: ${JSON.stringify(item.tags)}]` : '';
            combinedText += `${index + 1}. [Kategori: ${item.kategori}] ${tagString}\nIsi: ${item.teks_asli}\n\n`;
        });

return { hasil: combinedText }; // BENAR

    } catch (error) {
        console.error("[gali_ingatan] Error:", error);
        return {
            status: "error",
            message: "Gagal menggali ingatan.",
            error: error.message
        };
    }
}