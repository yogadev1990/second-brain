import axios from 'axios';
import { createAgentLogger } from '../core/logger/index.js';

const logger = createAgentLogger('McpClient');

export class McpClient {
    constructor() {
        this.serverUrl = process.env.MCP_SERVER_URL || 'http://localhost:4000';
        this.toolsCache = [];
        this.isAvailable = false;
        this.lastChecked = null;
    }

    /**
     * Konversi JSON Schema standar MCP ke format functionDeclaration Gemini
     * @param {object} mcpTool 
     * @returns {object} Gemini FunctionDeclaration
     */
    static convertMcpSchemaToGemini(mcpTool) {
        const { name, description, inputSchema } = mcpTool;

        const convertProperties = (props = {}) => {
            const converted = {};
            for (const [key, value] of Object.entries(props)) {
                converted[key] = {
                    type: (value.type || 'STRING').toUpperCase(),
                    description: value.description || ''
                };
                if (value.enum) {
                    converted[key].enum = value.enum;
                }
                if (value.type === 'array' && value.items) {
                    converted[key].items = {
                        type: (value.items.type || 'STRING').toUpperCase()
                    };
                }
            }
            return converted;
        };

        return {
            name,
            description: description || `Tool MCP Sandbox: ${name}`,
            parameters: {
                type: 'OBJECT',
                properties: convertProperties(inputSchema?.properties || {}),
                required: inputSchema?.required || []
            }
        };
    }

    /**
     * Ambil daftar tool dari MCP Sandbox Server
     */
    async fetchTools() {
        const client = axios.create({
            baseURL: this.serverUrl,
            timeout: 5000
        });

        try {
            // Coba ambil via endpoint REST cepat terlebih dahulu
            const response = await client.get('/tools');
            if (response.data && Array.isArray(response.data.tools)) {
                this.toolsCache = response.data.tools;
                this.isAvailable = true;
                this.lastChecked = new Date();
                logger.info(`✅ Berhasil memuat ${this.toolsCache.length} tools dari MCP Sandbox.`);
                return this.toolsCache;
            }
        } catch (err) {
            // Jika REST belum merespons, coba JSON-RPC standard
            try {
                const rpcResponse = await client.post('/message', {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/list',
                    params: {}
                });
                if (rpcResponse.data?.result?.tools) {
                    this.toolsCache = rpcResponse.data.result.tools;
                    this.isAvailable = true;
                    this.lastChecked = new Date();
                    logger.info(`✅ Berhasil memuat ${this.toolsCache.length} tools dari MCP JSON-RPC.`);
                    return this.toolsCache;
                }
            } catch (rpcErr) {
                this.isAvailable = false;
                logger.warn(`⚠️ MCP Sandbox (${this.serverUrl}) sedang offline atau belum siap: ${rpcErr.message}`);
                return [];
            }
        }

        return [];
    }

    /**
     * Eksekusi tool di dalam kontainer MCP Sandbox
     * @param {string} toolName 
     * @param {object} args 
     */
    async executeTool(toolName, args = {}) {
        const client = axios.create({
            baseURL: this.serverUrl,
            timeout: 130000 // 130s (mengizinkan eksekusi script sampai 120s)
        });

        logger.info({ toolName, args }, `[MCP Client] Meneruskan eksekusi tool ke Sandbox...`);

        try {
            const response = await client.post('/tools/call', {
                name: toolName,
                arguments: args
            });

            const content = response.data?.content;
            if (Array.isArray(content) && content[0]?.text) {
                try {
                    return JSON.parse(content[0].text);
                } catch (_) {
                    return { result: content[0].text, isError: response.data?.isError || false };
                }
            }

            return response.data || { status: 'success' };
        } catch (error) {
            logger.error({ toolName, err: error.message }, `[MCP Client] Eksekusi tool di sandbox gagal.`);
            return {
                status: 'error',
                message: `Gagal menghubungi MCP Sandbox: ${error.message}`
            };
        }
    }
}

export const mcpClient = new McpClient();
