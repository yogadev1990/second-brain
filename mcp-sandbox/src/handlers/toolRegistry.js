import fs from 'fs';
import path from 'path';
import { Executor } from './executor.js';
import { GitSync } from './gitSync.js';
import { BratGenerator } from './bratGenerator.js';
import { redisLogger } from '../services/redisLogger.js';

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.resolve(process.cwd(), 'workspace');
const CUSTOM_TOOLS_DIR = path.join(WORKSPACE_DIR, 'custom_tools');

export class ToolRegistry {
    constructor() {
        this.tools = new Map();
        this.registerBuiltInTools();
        this.loadCustomTools();
    }

    loadCustomTools() {
        if (!fs.existsSync(CUSTOM_TOOLS_DIR)) {
            try { fs.mkdirSync(CUSTOM_TOOLS_DIR, { recursive: true }); } catch (_) {}
            return;
        }

        try {
            const files = fs.readdirSync(CUSTOM_TOOLS_DIR);
            const jsonFiles = files.filter(f => f.endsWith('.json'));

            for (const jsonFile of jsonFiles) {
                const configPath = path.join(CUSTOM_TOOLS_DIR, jsonFile);
                const rawConfig = fs.readFileSync(configPath, 'utf-8');
                const config = JSON.parse(rawConfig);

                if (!config.name || !config.scriptFile) continue;

                const scriptPath = path.join(CUSTOM_TOOLS_DIR, config.scriptFile);
                if (!fs.existsSync(scriptPath)) continue;

                const lang = (config.language || (config.scriptFile.endsWith('.py') ? 'python' : 'javascript')).toLowerCase();

                this.register({
                    name: config.name,
                    description: config.description || `Tool kustom: ${config.name}`,
                    inputSchema: config.inputSchema || { type: 'object', properties: {} },
                    handler: async (args = {}) => {
                        // Smart Input Unwrapping: Ekstrak parameter jika dibungkus dalam args.input
                        let normalizedArgs = { ...args };
                        if (typeof args.input === 'string') {
                            try {
                                const parsed = JSON.parse(args.input);
                                if (parsed && typeof parsed === 'object') {
                                    normalizedArgs = { ...normalizedArgs, ...parsed };
                                }
                            } catch (_) {}
                        } else if (typeof args.input === 'object' && args.input !== null) {
                            normalizedArgs = { ...normalizedArgs, ...args.input };
                        }

                        const scriptCode = fs.readFileSync(scriptPath, 'utf-8');
                        const argsJson = JSON.stringify(normalizedArgs);
                        
                        const wrappedCode = lang === 'python'
                            ? `import json, os, sys\nos.environ['TOOL_ARGS'] = ${JSON.stringify(argsJson)}\nsys.argv = [sys.argv[0], ${JSON.stringify(argsJson)}]\n\n${scriptCode}`
                            : `process.env.TOOL_ARGS = ${JSON.stringify(argsJson)};\n${scriptCode}`;

                        return await Executor.executeScript({
                            language: lang,
                            code: wrappedCode
                        });
                    }
                });
                console.log(`[ToolRegistry] Tool kustom dimuat: ${config.name}`);
            }
        } catch (err) {
            console.warn(`[ToolRegistry] Gagal memuat custom tools: ${err.message}`);
        }
    }

    registerBuiltInTools() {
        // 1. Eksekusi Script Bebas di Sandbox
        this.register({
            name: 'sandbox_execute_script',
            description: 'Mengeksekusi kode script (Python, JavaScript/Node, atau Bash) di dalam kontainer sandbox terisolasi. Jika script menghasilkan gambar, stiker, atau grafik visual (menggunakan Pillow, matplotlib, dll.), simpan file gambar di direktori kerja (misal: "output.png" atau "brat.png") atau cetak JSON dengan field "image_base64". Sandbox akan otomatis mendeteksi dan menampilkannya langsung ke chatroom Mas Yoga.',
            inputSchema: {
                type: 'object',
                properties: {
                    language: {
                        type: 'string',
                        enum: ['python', 'javascript', 'bash'],
                        description: 'Bahasa pemrograman script yang akan dijalankan'
                    },
                    code: {
                        type: 'string',
                        description: 'Potongan kode atau script lengkap yang akan dieksekusi'
                    },
                    timeoutMs: {
                        type: 'number',
                        description: 'Batas waktu eksekusi dalam milidetik (default 30000ms, maksimal 120000ms)'
                    }
                },
                required: ['language', 'code']
            },
            handler: async (args) => await Executor.executeScript(args)
        });

        // 2. Download Dependensi Dinamis
        this.register({
            name: 'sandbox_install_dependency',
            description: 'Mengunduh dan memasang library atau paket baru (npm atau pip) secara dinamis di kontainer sandbox Waguri.',
            inputSchema: {
                type: 'object',
                properties: {
                    ecosystem: {
                        type: 'string',
                        enum: ['npm', 'pip'],
                        description: 'Ekosistem paket yang ingin diinstal: npm (Node.js) atau pip (Python)'
                    },
                    packages: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Daftar nama paket yang ingin diinstal (contoh: ["beautifulsoup4", "requests"])'
                    }
                },
                required: ['ecosystem', 'packages']
            },
            handler: async (args) => await Executor.installDependency(args)
        });

        // 3. Sinkronisasi Git
        this.register({
            name: 'sandbox_git_sync',
            description: 'Menyinkronkan repositori tools dari Git dan memperbarui alat-alat eksternal di sandbox secara dinamis.',
            inputSchema: {
                type: 'object',
                properties: {
                    repoUrl: {
                        type: 'string',
                        description: 'URL repositori Git yang berisi tools (opsional, default dari environment)'
                    },
                    branch: {
                        type: 'string',
                        description: 'Nama branch git (default: main)'
                    }
                }
            },
            handler: async (args) => await GitSync.syncRepo(args)
        });

        // 4. Jelajah Workspace Sandbox
        this.register({
            name: 'sandbox_list_files',
            description: 'Melihat file-file dan hasil eksekusi yang tersimpan di dalam direktori workspace sandbox.',
            inputSchema: {
                type: 'object',
                properties: {
                    subpath: {
                        type: 'string',
                        description: 'Sub-direktori dalam workspace untuk diinspeksi'
                    }
                }
            },
            handler: async (args) => await Executor.listWorkspaceFiles(args)
        });

        // 5. Generator Stiker Brat (Charli XCX Style)
        this.register({
            name: 'generate_brat_sticker',
            description: 'Membuat stiker teks bergaya album Brat (Charli XCX) dengan latar hijau limau ikonik (#8ACE00) dan teks sans-serif hitam agak buram khas album cover. Hasil gambar langsung disajikan otomatis ke obrolan Mas Yoga.',
            inputSchema: {
                type: 'object',
                properties: {
                    text: {
                        type: 'string',
                        description: 'Teks yang ingin dicetak pada stiker (misal: "waguri ayu", "brat", "santai dulu")'
                    },
                    size: {
                        type: 'number',
                        description: 'Ukuran piksel kanvas persegi (opsional, default 800)'
                    }
                },
                required: ['text']
            },
            handler: async (args) => await BratGenerator.generate(args)
        });

        // 6. Registrasi Tool Kustom Baru (Dynamic Skill Factory)
        this.register({
            name: 'sandbox_register_custom_tool',
            description: 'Mendaftarkan skill atau tool baru secara permanen ke dalam MCP Sandbox. Tool yang didaftarkan akan tersimpan di disk (/workspace/custom_tools/) dan dapat dipanggil berulang kali selamanya tanpa perlu menulis ulang kodenya.',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Nama unik tool dalam format snake_case (contoh: "hitung_imt", "generator_meme_drake", "cek_harga_emas")'
                    },
                    description: {
                        type: 'string',
                        description: 'Deskripsi lengkap tentang kegunaan tool dan kapan tool ini harus dipanggil oleh AI'
                    },
                    language: {
                        type: 'string',
                        enum: ['python', 'javascript'],
                        description: 'Bahasa pemrograman script tool (default: python)'
                    },
                    code: {
                        type: 'string',
                        description: 'Kode script lengkap. Argumen pemanggilan dapat dibaca via os.environ["TOOL_ARGS"] (JSON string) atau sys.argv[1] (JSON string)'
                    },
                    inputSchema: {
                        type: 'object',
                        description: 'Skema parameter input dalam format JSON Schema (type, properties, required)'
                    }
                },
                required: ['name', 'description', 'code']
            },
            handler: async (args) => {
                const { name, description, language = 'python', code, inputSchema } = args;

                const cleanName = (name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
                if (!cleanName) throw new Error('Nama tool tidak valid.');

                if (!fs.existsSync(CUSTOM_TOOLS_DIR)) {
                    fs.mkdirSync(CUSTOM_TOOLS_DIR, { recursive: true });
                }

                const ext = language === 'javascript' ? 'mjs' : 'py';
                const scriptFileName = `${cleanName}.${ext}`;
                const scriptPath = path.join(CUSTOM_TOOLS_DIR, scriptFileName);
                const configPath = path.join(CUSTOM_TOOLS_DIR, `${cleanName}.json`);

                fs.writeFileSync(scriptPath, code, 'utf-8');

                const toolMetadata = {
                    name: cleanName,
                    description: description || `Tool kustom ${cleanName}`,
                    language,
                    scriptFile: scriptFileName,
                    inputSchema: inputSchema || { type: 'object', properties: {} },
                    createdAt: new Date().toISOString()
                };

                fs.writeFileSync(configPath, JSON.stringify(toolMetadata, null, 2), 'utf-8');

                this.loadCustomTools();
                await redisLogger.logProgress('done', `Tool kustom '${cleanName}' berhasil didaftarkan secara permanen di sandbox!`);

                return {
                    status: 'success',
                    name: cleanName,
                    message: `Tool '${cleanName}' berhasil disimpan permanen di sandbox dan siap digunakan selamanya.`,
                    metadata: toolMetadata
                };
            }
        });
    }

    register({ name, description, inputSchema, handler }) {
        this.tools.set(name, {
            name,
            description,
            inputSchema,
            handler
        });
    }

    /**
     * Mendapatkan daftar tool dalam format MCP (Model Context Protocol)
     */
    listTools() {
        return Array.from(this.tools.values()).map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema
        }));
    }

    /**
     * Eksekusi tool berdasarkan nama dan argumen
     */
    async callTool(name, args = {}) {
        const tool = this.tools.get(name);
        if (!tool) {
            throw new Error(`Tool '${name}' tidak ditemukan di MCP Sandbox Registry.`);
        }

        try {
            const result = await tool.handler(args);
            const isError = result?.status === 'error';
            return {
                content: [
                    {
                        type: 'text',
                        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                    }
                ],
                isError
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error mengeksekusi tool ${name}: ${error.message}`
                    }
                ],
                isError: true
            };
        }
    }
}

export const toolRegistry = new ToolRegistry();
