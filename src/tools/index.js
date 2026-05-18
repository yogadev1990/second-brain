import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadTools() {
    const declarations = [];
    const handlers = {};
    const folders = ['vps', 'android', 'eksternal'];

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
    
    return { declarations, handlers };
}

// Top-level await diperbolehkan di ES Modules
// Kami load secara dinamis semua tools pada saat modul ini di-import
const registry = await loadTools();

// Ekspor registry yang akan disuntikkan ke Gemini
export const toolDeclarations = registry.declarations;
export const toolHandlers = registry.handlers;
