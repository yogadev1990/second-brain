import { mongoMemoryService } from '../../services/mongoMemoryService.js';
import Memori from '../../models/Memori.js';
import { createAgentLogger } from '../../core/logger/index.js';

const logger = createAgentLogger('TheArchivist');

// Export model Memori sebagai MemoryDocument untuk kompatibilitas ke belakang
export const MemoryDocument = Memori;

/**
 * Eksekusi Hybrid Search menggunakan algoritma Reciprocal Rank Fusion (RRF)
 * Menggabungkan MongoDB Vector Search (Semantik) dan MongoDB Text Index (Kata Kunci)
 * 
 * @param {string} query - Kalimat query atau kata kunci pencarian
 * @param {number} [limit=5] - Jumlah hasil teratas yang diinginkan
 * @returns {Promise<Array<{ id: string, score: number, content: string, category: string, source: string }>>}
 */
export async function executeHybridRRFSearch(query, limit = 5) {
    try {
        logger.info({ query, limit }, 'Menjalankan MongoDB Hybrid RRF Search...');
        const results = await mongoMemoryService.searchHybridRRF(query, { limit });
        return results;
    } catch (error) {
        logger.error({ err: error.message }, 'Eksekusi Hybrid RRF Search gagal');
        throw error;
    }
}
