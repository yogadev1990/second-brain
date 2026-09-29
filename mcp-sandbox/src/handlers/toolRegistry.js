import { Executor } from './executor.js';
import { GitSync } from './gitSync.js';

export class ToolRegistry {
    constructor() {
        this.tools = new Map();
        this.registerBuiltInTools();
    }

    registerBuiltInTools() {
        // 1. Eksekusi Script Bebas di Sandbox
        this.register({
            name: 'sandbox_execute_script',
            description: 'Mengeksekusi kode script (Python, JavaScript/Node, atau Bash) di dalam kontainer sandbox terisolasi tanpa membebani otak utama Waguri.',
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
