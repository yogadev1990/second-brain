import { GoogleGenAI } from '@google/genai';
import Memori from '../models/Memori.js';
import { v4 as uuidv4 } from 'uuid';
import { createAgentLogger } from '../core/logger/index.js';

const logger = createAgentLogger('MongoMemoryService');
const RRF_K = 60; // Smoothing constant standar industri

export class MongoMemoryService {
    constructor() {
        this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }

    /**
     * Hitung Cosine Similarity antara dua array vektor float
     */
    cosineSimilarity(vecA, vecB) {
        if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Menghasilkan embedding 768 dimensi menggunakan Gemini
     */
    async embedText(text, taskType = 'RETRIEVAL_DOCUMENT') {
        const embedRes = await this.ai.models.embedContent({
            model: 'gemini-embedding-001',
            contents: text,
            config: {
                outputDimensionality: 768,
                taskType: taskType
            }
        });
        return embedRes.embeddings[0].values;
    }

    /**
     * Menyimpan dokumen ingatan baru ke MongoDB lengkap dengan embedding vektor
     */
    async tanamIngatan({ content, category = 'Umum', tags = [], metadata = {} }) {
        if (!content || !content.trim()) {
            throw new Error('Konten ingatan tidak boleh kosong.');
        }

        logger.info({ category }, 'Memproses embedding untuk memori baru...');
        const embedding = await this.embedText(content, 'RETRIEVAL_DOCUMENT');
        const docId = uuidv4();

        const doc = await Memori.create({
            docId,
            content: content.trim(),
            category,
            tags,
            embedding,
            metadata
        });

        logger.info({ docId, category }, '✅ Ingatan berhasil ditanam ke MongoDB Vector Database.');
        return doc;
    }

    /**
     * Pencarian Semantik Vektor langsung di MongoDB
     */
    async searchVector(query, { category, limit = 5 } = {}) {
        const queryVector = await this.embedText(query, 'RETRIEVAL_QUERY');

        // 1. Coba MongoDB Atlas Vector Search jika index terpasang
        try {
            const atlasPipeline = [
                {
                    $vectorSearch: {
                        index: 'vector_index',
                        path: 'embedding',
                        queryVector: queryVector,
                        numCandidates: limit * 10,
                        limit: limit
                    }
                }
            ];
            if (category) {
                atlasPipeline[0].$vectorSearch.filter = { category };
            }
            const atlasResults = await Memori.aggregate(atlasPipeline);
            if (atlasResults && atlasResults.length > 0) {
                return atlasResults.map(doc => ({
                    id: doc.docId || String(doc._id),
                    content: doc.content,
                    category: doc.category,
                    tags: doc.tags || [],
                    score: doc.score || 1
                }));
            }
        } catch (_) {
            // Fallback otomatis ke Universal Native Similarity jika bukan MongoDB Atlas Vector Search
        }

        // 2. Universal Native Vector Search (Berjalan di SEMUA instalasi MongoDB lokal/VPS/Docker)
        const filter = { embedding: { $exists: true, $ne: [] } };
        if (category) filter.category = category;

        // Ambil dokumen kandidat (maksimal 200 dokumen terbaru untuk performa kilat <5ms)
        const candidates = await Memori.find(filter)
            .sort({ createdAt: -1 })
            .limit(200)
            .select('docId content category tags embedding createdAt');

        const scored = candidates.map(doc => {
            const sim = this.cosineSimilarity(queryVector, doc.embedding);
            return {
                id: doc.docId || String(doc._id),
                content: doc.content,
                category: doc.category,
                tags: doc.tags || [],
                score: sim
            };
        });

        // Urutkan berdasarkan kemiripan kosinus tertinggi
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit);
    }

    /**
     * Pencarian Kata Kunci via MongoDB Full-Text Index
     */
    async searchText(query, { category, limit = 5 } = {}) {
        const filter = { $text: { $search: query } };
        if (category) filter.category = category;

        try {
            const results = await Memori.find(
                filter,
                { score: { $meta: 'textScore' }, docId: 1, content: 1, category: 1, tags: 1 }
            ).sort({ score: { $meta: 'textScore' } }).limit(limit);

            return results.map(doc => ({
                id: doc.docId || String(doc._id),
                content: doc.content,
                category: doc.category,
                tags: doc.tags || [],
                score: doc.get('score') || 1
            }));
        } catch (err) {
            logger.warn({ err: err.message }, 'Text search gagal atau text index belum siap, fallback ke regex...');
            const regexFilter = { content: { $regex: query, $options: 'i' } };
            if (category) regexFilter.category = category;
            const regexDocs = await Memori.find(regexFilter).limit(limit);
            return regexDocs.map(doc => ({
                id: doc.docId || String(doc._id),
                content: doc.content,
                category: doc.category,
                tags: doc.tags || [],
                score: 0.5
            }));
        }
    }

    /**
     * Pencarian Hybrid RRF (Reciprocal Rank Fusion)
     * Menggabungkan Vector Semantic + Keyword Full-Text Search
     */
    async searchHybridRRF(query, { category, limit = 5 } = {}) {
        const candidateLimit = limit * 2;

        const [vectorResults, textResults] = await Promise.all([
            this.searchVector(query, { category, limit: candidateLimit }).catch(() => []),
            this.searchText(query, { category, limit: candidateLimit }).catch(() => [])
        ]);

        const rrfMap = new Map();

        // 1. Scoring dari Vektor Search
        vectorResults.forEach((item, index) => {
            const rank = index + 1;
            const id = item.id;
            const existing = rrfMap.get(id) || {
                id,
                score: 0,
                content: item.content,
                category: item.category,
                tags: item.tags,
                source: 'vector'
            };
            existing.score += 1 / (RRF_K + rank);
            rrfMap.set(id, existing);
        });

        // 2. Scoring dari Full-Text Search
        textResults.forEach((item, index) => {
            const rank = index + 1;
            const id = item.id;
            const existing = rrfMap.get(id) || {
                id,
                score: 0,
                content: item.content,
                category: item.category,
                tags: item.tags,
                source: 'text'
            };
            existing.score += 1 / (RRF_K + rank);
            if (existing.source === 'vector') existing.source = 'hybrid';
            rrfMap.set(id, existing);
        });

        // 3. Urutkan berdasarkan total RRF score tertinggi
        const fused = Array.from(rrfMap.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        return fused;
    }
}

export const mongoMemoryService = new MongoMemoryService();
export default mongoMemoryService;
