import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { mcpClient, McpClient } from '../services/mcpClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


async function loadTools() {
    const declarations = [];
    const handlers = {};
    const folders = ['vps', 'android', 'eksternal', 'memori', 'jadwal', 'keuangan'];

    console.log(`[Tools Registry] Memulai pemuatan alat-alat Waguri...`);

    for (const folder of folders) {
        const folderPath = path.join(__dirname, folder);
        
        // Buat folder secara otomatis jika belum ada
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
            continue;
        }

        // Cari semua file .js di dalam folder
        const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.js'));
        
        for (const file of files) {
            const filePath = path.join(folderPath, file);
            
            // Konversi absolute path ke file:// URL format agar bisa di import dynamic di Windows
            const fileUrl = pathToFileURL(filePath).href;
            
            try {
                const toolModule = await import(fileUrl);
                
                // Pastikan alat memenuhi Separation of Concerns (punya declaration dan execute)
                if (toolModule.declaration && typeof toolModule.execute === 'function') {
                    declarations.push(toolModule.declaration);
                    handlers[toolModule.declaration.name] = toolModule.execute;
                    console.log(`✅ Alat terdaftar: ${toolModule.declaration.name} (${folder}/${file})`);
                } else {
                    console.warn(`⚠️  Peringatan: ${folder}/${file} tidak memiliki export 'declaration' atau 'execute' yang valid.`);
                }
            } catch (err) {
                console.error(`❌ Gagal memuat alat ${folder}/${file}:`, err);
            }
        }
    }
    
    // Pemuatan alat dinamis dari MCP Sandbox Server (jika aktif)
    try {
        const mcpTools = await mcpClient.fetchTools();
        for (const tool of mcpTools) {
            const geminiDecl = McpClient.convertMcpSchemaToGemini(tool);
            declarations.push(geminiDecl);
            handlers[tool.name] = (args) => mcpClient.executeTool(tool.name, args);
            console.log(`📦 Alat MCP terdaftar: ${tool.name} (MCP Sandbox)`);
        }
    } catch (mcpErr) {
        console.warn(`[Tools Registry] Melewati pemuatan awal MCP tools: ${mcpErr.message}`);
    }

    return { declarations, handlers };
}

// Top-level await diperbolehkan di ES Modules
// Kami load secara dinamis semua tools pada saat modul ini di-import
const registry = await loadTools();

// Ekspor registry yang akan disuntikkan ke Gemini
export const toolDeclarations = registry.declarations;
export const toolHandlers = registry.handlers;

/**
 * Fungsi untuk memperbarui tools dari MCP Sandbox secara on-the-fly tanpa restart
 */
export async function refreshMcpTools() {
    try {
        const mcpTools = await mcpClient.fetchTools();
        for (const tool of mcpTools) {
            const geminiDecl = McpClient.convertMcpSchemaToGemini(tool);
            const existingIdx = toolDeclarations.findIndex(d => d.name === tool.name);
            if (existingIdx >= 0) {
                toolDeclarations[existingIdx] = geminiDecl;
            } else {
                toolDeclarations.push(geminiDecl);
            }
            toolHandlers[tool.name] = (args) => mcpClient.executeTool(tool.name, args);
        }
        return { success: true, count: mcpTools.length };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

