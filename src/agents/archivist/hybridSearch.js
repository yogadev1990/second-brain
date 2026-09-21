import mongoose from 'mongoose';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { GoogleGenAI } from '@google/genai';
import { createAgentLogger } from '../../core/logger/index.js';

const logger = createAgentLogger('TheArchivist');
const RRF_K = 60; // Smoothing constant standar industri

// Schema MongoDB untuk pencarian teks terindeks
const MemoryDocumentSchema = new mongoose.Schema({
    docId: { type: String, required: true, unique: true, index: true },
    content: { type: String, required: true },
    category: { type: String, default: 'General' },
    tags: [String],
    createdAt: { type: Date, default: Date.now }
});

// Pastikan Text Index terpasang untuk pencarian keyword/kode medis presisi
MemoryDocumentSchema.index({ content: 'text', category: 'text' });

export const MemoryDocument = mongoose.models.MemoryDocument || mongoose.model('MemoryDocument', MemoryDocumentSchema);

/**
 * Eksekusi Hybrid Search menggunakan algoritma Reciprocal Rank Fusion (RRF)
 * Menggabungkan Milvus Vector Search (Semantik) dan MongoDB Text Index (Kata Kunci/Kode)
 * 
 * @param {string} query - Kalimat query atau kata kunci pencarian
 * @param {number} [limit=5] - Jumlah hasil teratas yang diinginkan
 * @returns {Promise<Array<{ id: string, score: number, content: string, category: string, source: string }>>}
 */
export async function executeHybridRRFSearch(query, limit = 5) {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const milvusAddress = process.env.MILVUS_ADDRESS || `${process.env.MILVUS_HOST || 'localhost'}:${process.env.MILVUS_PORT || '19530'}`;

    try {
        // 1. Embedding Query menggunakan taskType 'RETRIEVAL_QUERY'
        const embedRes = await ai.models.embedContent({
            model: 'gemini-embedding-001',
            contents: query,
            config: {
                outputDimensionality: 768,
                taskType: 'RETRIEVAL_QUERY'
            }
        });
        const queryVector = embedRes.embeddings[0].values;

        // 2. Pencarian Vektor di Milvus (Top 2 * limit)
        let milvusResults = [];
        try {
            const milvus = new MilvusClient({ address: milvusAddress });
            const searchRes = await milvus.search({
                collection_name: 'Memori_Waguri',
                vector: queryVector,
                limit: limit * 2,
                output_fields: ['teks_asli', 'kategori', 'tags']
            });
            await milvus.closeConnection();
            milvusResults = searchRes.results || [];
        } catch (mErr) {
            logger.warn({ err: mErr.message }, 'Milvus tidak merespons atau belum aktif. Mengandalkan MongoDB full-text.');
        }

        // 3. Pencarian Kata Kunci di MongoDB Text Index (Top 2 * limit)
        let mongoResults = [];
        try {
            mongoResults = await MemoryDocument.find(
                { $text: { $search: query } },
                { score: { $meta: 'textScore' }, docId: 1, content: 1, category: 1 }
            ).sort({ score: { $meta: 'textScore' } }).limit(limit * 2);
        } catch (dbErr) {
            logger.warn({ err: dbErr.message }, 'Pencarian Text Index MongoDB gagal atau belum terindeks.');
        }

        // 4. Komputasi Reciprocal Rank Fusion (RRF)
        const rrfMap = new Map();

        // Evaluasi peringkat Milvus
        milvusResults.forEach((item, index) => {
            const rank = index + 1;
            const id = item.id ? String(item.id) : `milvus-${rank}`;
            const existing = rrfMap.get(id) || {
                id,
                score: 0,
                content: item.teks_asli,
                category: item.kategori,
                source: 'vector'
            };
            existing.score += 1 / (RRF_K + rank);
            rrfMap.set(id, existing);
        });

        // Evaluasi peringkat MongoDB Text Search
        mongoResults.forEach((item, index) => {
            const rank = index + 1;
            const id = item.docId || String(item._id);
            const existing = rrfMap.get(id) || {
                id,
                score: 0,
                content: item.content,
                category: item.category,
                source: 'text'
            };
            existing.score += 1 / (RRF_K + rank);
            if (existing.source === 'vector') existing.source = 'hybrid';
            rrfMap.set(id, existing);
        });

        // 5. Urutkan berdasarkan total RRF score tertinggi
        const fusedResults = Array.from(rrfMap.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        logger.info({ query, resultsCount: fusedResults.length }, 'Hybrid RRF Search selesai.');
        return fusedResults;

    } catch (error) {
        logger.error({ err: error.message }, 'Error saat menjalankan Hybrid RRF Search');
        return [];
    }
}
