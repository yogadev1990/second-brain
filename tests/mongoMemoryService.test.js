import assert from 'assert';
import { MongoMemoryService } from '../src/services/mongoMemoryService.js';

console.log('====================================================');
console.log('🧪 PENGUJIAN MONGODB MEMORY & VECTOR COSINE SIMILARITY');
console.log('====================================================');

const service = new MongoMemoryService();

// Test 1: Cosine Similarity Identik harus 1.0
const vecA = [1, 0, 0];
const vecB = [1, 0, 0];
const sim1 = service.cosineSimilarity(vecA, vecB);
assert.strictEqual(Math.round(sim1 * 100) / 100, 1.0, 'Vektor identik harus bernilai 1.0');
console.log('✅ PASS: Cosine similarity vektor identik = 1.0');

// Test 2: Cosine Similarity Ortogonal (tidak berhubungan) harus 0.0
const vecC = [0, 1, 0];
const sim2 = service.cosineSimilarity(vecA, vecC);
assert.strictEqual(sim2, 0, 'Vektor ortogonal harus bernilai 0');
console.log('✅ PASS: Cosine similarity vektor ortogonal = 0.0');

// Test 3: Cosine Similarity Berlawanan Arah harus -1.0
const vecD = [-1, 0, 0];
const sim3 = service.cosineSimilarity(vecA, vecD);
assert.strictEqual(Math.round(sim3 * 100) / 100, -1.0, 'Vektor berlawanan harus bernilai -1.0');
console.log('✅ PASS: Cosine similarity vektor berlawanan = -1.0');

console.log('====================================================');
console.log('🎉 SELURUH PENGUJIAN VEKTOR MATEMATIKA VALID 100%!');
console.log('====================================================');
