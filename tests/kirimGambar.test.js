import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { declaration, execute } from '../src/tools/eksternal/kirimGambar.js';

console.log('====================================================');
console.log('🧪 PENGUJIAN TOOL KIRIM GAMBAR WAGURI KE USER');
console.log('====================================================');

async function runTests() {
    // Test 1: Validasi Deklarasi Tool
    console.log('\n▶️  [Test 1] Pengujian Struktur Deklarasi Tool kirim_gambar');
    assert.strictEqual(declaration.name, 'kirim_gambar');
    assert.ok(declaration.description.includes('AI') || declaration.description.includes('gambar'));
    assert.strictEqual(declaration.parameters.type, 'object');
    assert.deepStrictEqual(declaration.parameters.required, ['tipe']);
    assert.ok(declaration.parameters.properties.tipe.enum.includes('generate_ai'));
    assert.ok(declaration.parameters.properties.tipe.enum.includes('dari_url'));
    assert.ok(declaration.parameters.properties.tipe.enum.includes('dari_file_lokal'));
    console.log('✅ PASS: Deklarasi tool mematuhi spesifikasi function calling.');

    // Test 2: Validasi Parameter Wajib
    console.log('\n▶️  [Test 2] Pengujian Validasi Parameter Hilang');
    const noTipe = await execute({});
    assert.strictEqual(noTipe.status, 'error');
    assert.ok(noTipe.message.includes('tipe'));

    const noPrompt = await execute({ tipe: 'generate_ai' });
    assert.strictEqual(noPrompt.status, 'error');

    const noUrl = await execute({ tipe: 'dari_url' });
    assert.strictEqual(noUrl.status, 'error');

    const noPath = await execute({ tipe: 'dari_file_lokal' });
    assert.strictEqual(noPath.status, 'error');
    console.log('✅ PASS: Seluruh validasi parameter hilang berhasil ditolak dengan aman.');

    // Test 3: Pengujian Melampirkan File Gambar Lokal
    console.log('\n▶️  [Test 3] Pengujian Melampirkan File Gambar Lokal ke Media Publik');
    const dummyDir = path.join(process.cwd(), 'public', 'test_scratch');
    if (!fs.existsSync(dummyDir)) fs.mkdirSync(dummyDir, { recursive: true });

    const dummySource = path.join(dummyDir, 'test_sample.png');
    fs.writeFileSync(dummySource, 'DUMMY_IMAGE_DATA_12345');

    const localResult = await execute({
        tipe: 'dari_file_lokal',
        path_file_lokal: dummySource,
        caption: 'Ini foto uji coba untuk Mas Yoga'
    });

    assert.strictEqual(localResult.status, 'success');
    assert.ok(localResult.media);
    assert.strictEqual(localResult.media.type, 'image');
    assert.strictEqual(localResult.media.caption, 'Ini foto uji coba untuk Mas Yoga');
    assert.ok(localResult.media.relativePath.startsWith('/media/local_'));

    // Pastikan file tersimpan di public/media
    const savedPath = path.join(process.cwd(), 'public', localResult.media.relativePath);
    assert.ok(fs.existsSync(savedPath));
    console.log(`✅ PASS: File lokal berhasil disalin ke media statis (${localResult.media.relativePath}).`);

    // Bersihkan file uji coba
    try {
        fs.unlinkSync(dummySource);
        fs.rmdirSync(dummyDir);
        fs.unlinkSync(savedPath);
    } catch (_) {}

    console.log('\n====================================================');
    console.log('🎉 PENGUJIAN TOOL KIRIM GAMBAR LOLOS 100%!');
    console.log('====================================================\n');
}

runTests().catch(err => {
    console.error('❌ Pengujian gagal:', err);
    process.exit(1);
});
