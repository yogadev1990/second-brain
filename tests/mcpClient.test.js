import assert from 'assert';
import { McpClient } from '../src/services/mcpClient.js';
import { ToolRegistry } from '../mcp-sandbox/src/handlers/toolRegistry.js';

console.log('====================================================');
console.log('🧪 PENGUJIAN MODULAR MCP SANDBOX & CLIENT');
console.log('====================================================');

async function runTests() {
    // Test 1: Konversi Schema MCP ke format Gemini FunctionDeclaration
    console.log('\n▶️  [Test 1] Pengujian Konversi Schema MCP ke Format Gemini');
    const mockMcpTool = {
        name: 'test_scraper',
        description: 'Scrape data website',
        inputSchema: {
            type: 'object',
            properties: {
                targetUrl: { type: 'string', description: 'URL tujuan' },
                maxPages: { type: 'number', description: 'Jumlah halaman' },
                tags: { type: 'array', items: { type: 'string' } }
            },
            required: ['targetUrl']
        }
    };

    const geminiDecl = McpClient.convertMcpSchemaToGemini(mockMcpTool);
    assert.strictEqual(geminiDecl.name, 'test_scraper');
    assert.strictEqual(geminiDecl.parameters.type, 'OBJECT');
    assert.strictEqual(geminiDecl.parameters.properties.targetUrl.type, 'STRING');
    assert.strictEqual(geminiDecl.parameters.properties.maxPages.type, 'NUMBER');
    assert.strictEqual(geminiDecl.parameters.properties.tags.type, 'ARRAY');
    assert.strictEqual(geminiDecl.parameters.properties.tags.items.type, 'STRING');
    assert.deepStrictEqual(geminiDecl.parameters.required, ['targetUrl']);
    console.log('✅ PASS: Skema MCP berhasil dikonversi ke format Gemini FunctionDeclaration secara presisi.');

    // Test 2: Fallback saat MCP Sandbox Server Offline
    console.log('\n▶️  [Test 2] Pengujian Graceful Fallback saat Server Sandbox Offline');
    const offlineClient = new McpClient();
    offlineClient.serverUrl = 'http://127.0.0.1:59999'; // Port yang sengaja tidak ada

    const tools = await offlineClient.fetchTools();
    assert.ok(Array.isArray(tools));
    assert.strictEqual(tools.length, 0);
    assert.strictEqual(offlineClient.isAvailable, false);
    console.log('✅ PASS: Client tidak crash saat server offline, mengembalikan array kosong dengan aman.');

    const execResult = await offlineClient.executeTool('dummy_tool', {});
    assert.strictEqual(execResult.status, 'error');
    assert.ok(execResult.message.includes('Gagal menghubungi MCP Sandbox'));
    console.log('✅ PASS: Eksekusi tool offline ditangani dengan status error yang elegan.');

    // Test 3: Registri Tool Bawaan Sandbox
    console.log('\n▶️  [Test 3] Pengujian ToolRegistry Bawaan di mcp-sandbox');
    const registry = new ToolRegistry();
    const builtInTools = registry.listTools();
    
    assert.strictEqual(builtInTools.length, 4);
    const toolNames = builtInTools.map(t => t.name);
    assert.ok(toolNames.includes('sandbox_execute_script'));
    assert.ok(toolNames.includes('sandbox_install_dependency'));
    assert.ok(toolNames.includes('sandbox_git_sync'));
    assert.ok(toolNames.includes('sandbox_list_files'));
    console.log(`✅ PASS: Ke-4 tool bawaan sandbox terdaftar: ${toolNames.join(', ')}.`);

    // Test 4: Eksekusi Script JavaScript di Sandbox
    console.log('\n▶️  [Test 4] Pengujian Eksekusi Script JavaScript di Sandbox');
    const jsResult = await registry.callTool('sandbox_execute_script', {
        language: 'javascript',
        code: 'const a = 15; const b = 27; console.log("Hasil penjumlahan:", a + b);'
    });

    assert.strictEqual(jsResult.isError, false);
    assert.ok(jsResult.content[0].text.includes('Hasil penjumlahan: 42'));
    console.log('✅ PASS: Script JavaScript dieksekusi dengan aman dan menghasilkan output yang tepat.');

    // Test 5: Sandbox List Files
    console.log('\n▶️  [Test 5] Pengujian Jelajah File Workspace Sandbox');
    const listResult = await registry.callTool('sandbox_list_files', {});
    assert.strictEqual(listResult.isError, false);
    assert.ok(listResult.content[0].text.includes('status'));
    console.log('✅ PASS: Pembacaan direktori workspace sandbox berjalan aman.');

    console.log('====================================================');
    console.log('🎉 SELURUH PENGUJIAN MODULAR MCP SANDBOX LOLOS 100%!');
    console.log('====================================================\n');
}

runTests().catch(err => {
    console.error('❌ Pengujian gagal:', err);
    process.exit(1);
});
