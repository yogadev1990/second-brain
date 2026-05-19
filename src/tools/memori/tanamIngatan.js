import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { GoogleGenAI } from '@google/genai';

let milvusAddress = null;

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
    // Inisialisasi SDK Baru
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    if (!milvusAddress) {
        milvusAddress = process.env.MILVUS_ADDRESS || `${process.env.MILVUS_HOST}:${process.env.MILVUS_PORT}`;
    }

    const { teks_mentah } = args;

    if (!teks_mentah) {
        return { status: "error", message: "Parameter teks_mentah wajib diisi." };
    }

    try {
        // Tahap 1: Auto-Tagging Hemat Token menggunakan SDK Baru
        const promptTagging = `Ekstrak teks berikut ke dalam JSON murni yang berisi 'kategori' (pilih satu: Jurnal, Proyek, Log_Aktivitas, Ide, Fakta_Pribadi) dan 'tags' (array 3 kata kunci). Jangan berikan teks lain. Teks: ${teks_mentah}`;
        
        const taggingResult = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: promptTagging,
            config: {
                responseMimeType: "application/json",
            }
        });
        
        const taggingJson = JSON.parse(taggingResult.text);
        const kategori = taggingJson.kategori || "Ide";
        const tags = taggingJson.tags || [];

        // Tahap 2: Embedding Spesifik dengan Task Type & Dimensi
        const embedResponse = await ai.models.embedContent({
            model: 'gemini-embedding-001',
            contents: teks_mentah,
            config: { 
                outputDimensionality: 768,
                taskType: 'RETRIEVAL_DOCUMENT' // Wajib untuk data yang masuk ke database
            },
        });
        
        const vektor = embedResponse.embeddings[0].values;

        // Tahap 3: Insert ke Milvus
        const milvusClient = new MilvusClient({ address: milvusAddress });
        
        const insertRes = await milvusClient.insert({
            collection_name: "Memori_Waguri",
            data: [
                {
                    vektor: vektor,
                    teks_asli: teks_mentah,
                    kategori: kategori,
                    tags: tags 
                }
            ],
        });

        await milvusClient.closeConnection();

        return {
            status: "success",
            message: "Ingatan berhasil ditanam.",
            kategori: kategori,
            tags: tags,
            insert_result: insertRes
        };

    } catch (error) {
        console.error("[tanam_ingatan] Error:", error);
        return {
            status: "error",
            message: "Gagal menanam ingatan.",
            error: error.message
        };
    }
}