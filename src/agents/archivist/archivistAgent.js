import { eventBus } from '../../core/bus/eventBus.js';
import { TOPICS } from '../../core/bus/topics.js';
import { createAgentLogger } from '../../core/logger/index.js';
import { executeHybridRRFSearch } from './hybridSearch.js';
import { mongoMemoryService } from '../../services/mongoMemoryService.js';
import ChatSession from '../../models/ChatSession.js';
import { GoogleGenAI } from '@google/genai';

const logger = createAgentLogger('TheArchivist');

export class ArchivistAgent {
    constructor() {
        this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }

    async init() {
        logger.info('Menginisialisasi Subagen The Archivist (Memory Engine via MongoDB Vector)...');

        // Handler untuk RPC Hybrid Search dari Master Agent
        await eventBus.subscribe(TOPICS.MEMORY.SEARCH_HYBRID, async (event) => {
            const { query, limit } = event.payload || {};
            try {
                const results = await executeHybridRRFSearch(query, limit || 5);
                if (event.replyTo && event.correlationId) {
                    await eventBus.respond(event.replyTo, event.correlationId, 'TheArchivist', {
                        status: 'success',
                        data: results
                    });
                }
            } catch (err) {
                logger.error({ err: err.message }, 'Gagal melayani Hybrid Search RPC');
                if (event.replyTo && event.correlationId) {
                    await eventBus.respond(event.replyTo, event.correlationId, 'TheArchivist', {
                        status: 'error',
                        message: err.message
                    });
                }
            }
        });

        // Handler untuk Ingest Memory Teks Baru ke MongoDB Vector Database
        await eventBus.subscribe(TOPICS.MEMORY.INGEST_FACT, async (event) => {
            const { content, category, tags } = event.payload || {};
            if (!content) return;

            try {
                const doc = await mongoMemoryService.tanamIngatan({
                    content,
                    category: category || 'General',
                    tags: tags || []
                });
                logger.info({ docId: doc.docId, category }, 'Fakta baru berhasil disimpan ke MongoDB Vector & Text Index.');
            } catch (err) {
                logger.error({ err: err.message }, 'Gagal menyimpan ingatan ke database vektor');
            }
        });

        logger.info('✅ The Archivist aktif dan siap mengelola ingatan (MongoDB RAG Mode).');
    }

    /**
     * Background worker untuk mengekstraksi fakta penting dari obrolan harian
     */
    async extractDailyMemories() {
        logger.info('Menjalankan background worker ekstraksi memori obrolan...');
        try {
            const sessions = await ChatSession.find({});
            for (const session of sessions) {
                if (!session.history || session.history.length < 4) continue;

                // Ambil dialog terbaru
                const conversationText = session.history
                    .map(msg => `${msg.role}: ${msg.parts?.map(p => p.text).join(' ')}`)
                    .join('\n');

                const prompt = `Analisis percakapan berikut. Ekstrak fakta baru, janji, preferensi, atau ide penting tentang pengguna jika ada. Kembalikan dalam format JSON array of strings: ["fakta 1", "fakta 2"]. Jika tidak ada yang penting, kembalikan [].\n\nPercakapan:\n${conversationText}`;

                const response = await this.ai.models.generateContent({
                    model: 'gemini-flash-latest',
                    contents: prompt,
                    config: { responseMimeType: 'application/json' }
                });

                const extracted = JSON.parse(response.text || '[]');
                for (const fact of extracted) {
                    await mongoMemoryService.tanamIngatan({
                        content: fact,
                        category: 'AutoExtracted_Daily',
                        tags: ['chat_log', session.deviceId || 'default']
                    });
                    logger.info({ fact }, 'Berhasil mengekstrak memori baru dari riwayat percakapan.');
                }
            }
        } catch (error) {
            logger.error({ err: error.message }, 'Gagal menjalankan ekstraksi memori harian');
        }
    }
}

export const archivistAgent = new ArchivistAgent();
