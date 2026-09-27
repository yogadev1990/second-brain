import assert from 'assert';
import { sanitizeGeminiHistory } from '../src/utils/geminiSanitizer.js';

console.log('====================================================');
console.log('🧪 PENGUJIAN SANITASI RIWAYAT CHAT GEMINI');
console.log('====================================================');

// Kasus 1: Riwayat korup dengan functionResponse 'cek_harga_emas' yatim piatu (persis seperti error di VPS)
const corruptHistory = [
    {
        role: 'user',
        parts: [{ text: 'Berapa harga emas hari ini?' }]
    },
    {
        role: 'user',
        parts: [{ functionResponse: { name: 'cek_harga_emas', response: { harga: 1400000 } } }]
    },
    {
        role: 'model',
        parts: [{ text: 'Harga emas saat ini sekitar Rp 1.400.000 per gram.' }]
    }
];

const cleaned1 = sanitizeGeminiHistory(corruptHistory);
assert.strictEqual(cleaned1.length, 2, 'Harus menyaring functionResponse dan hanya menyisakan 2 pesan teks');
assert.strictEqual(cleaned1[0].role, 'user');
assert.strictEqual(cleaned1[0].parts[0].text, 'Berapa harga emas hari ini?');
assert.strictEqual(cleaned1[1].role, 'model');
assert.strictEqual(cleaned1[1].parts[0].text, 'Harga emas saat ini sekitar Rp 1.400.000 per gram.');
console.log('✅ PASS: FunctionResponse yatim piatu berhasil disaring menjadi percakapan teks bersih.');

// Kasus 2: Riwayat diawali role 'model'
const leadingModelHistory = [
    { role: 'model', parts: [{ text: 'Halo Yoga!' }] },
    { role: 'user', parts: [{ text: 'Hai Waguri' }] },
    { role: 'model', parts: [{ text: 'Ada yang bisa Waguri bantu?' }] }
];
const cleaned2 = sanitizeGeminiHistory(leadingModelHistory);
assert.strictEqual(cleaned2[0].role, 'user', 'Elemen pertama selalu harus role user');
assert.strictEqual(cleaned2.length, 2);
console.log('✅ PASS: Leading model message berhasil disingkirkan, turn pertama selalu user.');

// Kasus 3: Input null / undefined / array kosong
assert.deepStrictEqual(sanitizeGeminiHistory(null), []);
assert.deepStrictEqual(sanitizeGeminiHistory([]), []);
console.log('✅ PASS: Input null/kosong ditangani dengan aman.');

console.log('====================================================');
console.log('🎉 SELURUH PENGUJIAN SANITASI GEMINI HISTORY LOLOS!');
console.log('====================================================');
