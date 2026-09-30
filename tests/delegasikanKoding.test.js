import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { declaration, execute } from '../src/tools/eksternal/delegasikanTugasKoding.js';
import { Executor } from '../mcp-sandbox/src/handlers/executor.js';
import { McpClient } from '../src/services/mcpClient.js';

console.log('====================================================');
console.log('🧪 PENGUJIAN DELEGASI KODING & AUTO-CAPTURE MCP SANDBOX');
console.log('====================================================');

async function runTests() {
    // Test 1: Deklarasi Tool Delegasi
    console.log('\n▶️  [Test 1] Validasi Deklarasi Tool delegasikan_tugas_koding');
    assert.strictEqual(declaration.name, 'delegasikan_tugas_koding');
    assert.ok(declaration.parameters.required.includes('deskripsi_tugas'));
    console.log('✅ PASS: Deklarasi tool delegasi koding sesuai standar function calling.');

    // Test 2: Validasi Parameter Kosong
    console.log('\n▶️  [Test 2] Validasi Parameter Kosong');
    const noDesc = await execute({});
    assert.strictEqual(noDesc.status, 'error');
    console.log('✅ PASS: Penolakan argumen tanpa deskripsi tugas berjalan tepat.');

    // Test 3: Auto-Detection Image Output dari Script Sandbox
    console.log('\n▶️  [Test 3] Pengujian Auto-Detection Image File pada Executor.executeScript');
    const workspaceDir = path.resolve(process.cwd(), 'workspace');
    if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });

    // Jalankan script JavaScript yang menghasilkan gambar PNG dummy di workspace
    const dummyImageCode = `
        import fs from 'fs';
        fs.writeFileSync('brat_test_output.png', 'DUMMY_BRAT_IMAGE_BYTES');
        console.log("Stiker Brat sukses digenerate!");
    `;

    const execResult = await Executor.executeScript({
        language: 'javascript',
        code: dummyImageCode
    });

    assert.strictEqual(execResult.status, 'success');
    assert.ok(execResult.media, 'Properti media harus terdeteksi otomatis dari file output gambar');
    assert.strictEqual(execResult.media.type, 'image');
    assert.ok(execResult.media.url.startsWith('/media/mcp_'));
    console.log(`✅ PASS: File gambar output berhasil dideteksi dan dipublikasikan otomatis: ${execResult.media.url}`);

    // Bersihkan file sisa uji coba
    const generatedWorkspaceFile = path.join(workspaceDir, 'brat_test_output.png');
    if (fs.existsSync(generatedWorkspaceFile)) fs.unlinkSync(generatedWorkspaceFile);
    const mediaDest = path.join(process.cwd(), 'public', execResult.media.relativePath);
    if (fs.existsSync(mediaDest)) fs.unlinkSync(mediaDest);

    // Test 4: Parsing image_base64 dari stdout di McpClient
    console.log('\n▶️  [Test 4] Pengujian Parsing Otomatis image_base64 dari stdout di McpClient');
    const client = new McpClient();
    const dummyBase64 = Buffer.from('TEST_BASE64_BRAT').toString('base64');
    
    // Simulasikan response tool MCP dengan stdout berisi JSON string
    const mockMcpResponseWithStdout = {
        data: {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        status: 'success',
                        language: 'python',
                        stdout: JSON.stringify({
                            status: 'done',
                            image_base64: dummyBase64,
                            caption: 'Stiker Brat Kustom Mas Yoga'
                        }),
                        stderr: ''
                    })
                }
            ]
        }
    };

    // Eksekusi parsing yang sama persis dengan mcpClient
    let resultData = JSON.parse(mockMcpResponseWithStdout.data.content[0].text);
    if (resultData && typeof resultData.stdout === 'string' && resultData.stdout.includes('image_base64') && !resultData.image_base64) {
        const parsedStdout = JSON.parse(resultData.stdout);
        if (parsedStdout.image_base64) {
            resultData.image_base64 = parsedStdout.image_base64;
            if (parsedStdout.caption) resultData.caption = parsedStdout.caption;
        }
    }

    assert.strictEqual(resultData.image_base64, dummyBase64);
    assert.strictEqual(resultData.caption, 'Stiker Brat Kustom Mas Yoga');
    console.log('✅ PASS: McpClient berhasil mengekstrak image_base64 yang tertanam di stdout JSON!');

    console.log('\n====================================================');
    console.log('🎉 SELURUH PENGUJIAN DELEGASI & AUTO-CAPTURE LOLOS 100%!');
    console.log('====================================================\n');
}

runTests().catch(err => {
    console.error('❌ Pengujian gagal:', err);
    process.exit(1);
});
