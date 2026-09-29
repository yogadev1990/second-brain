import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { redisLogger } from './services/redisLogger.js';
import { toolRegistry } from './handlers/toolRegistry.js';
import { GitSync } from './handlers/gitSync.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Inisialisasi koneksi Redis Logger ke nervous system Waguri
await redisLogger.init();

// Sesi SSE aktif untuk streaming MCP
const activeSessions = new Map();

/**
 * 1. Healthcheck Endpoint
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'waguri-mcp-sandbox',
        toolsCount: toolRegistry.listTools().length,
        timestamp: new Date().toISOString()
    });
});

/**
 * 2. REST Endpoints (Fast Direct Tool Access & Fallback)
 */
app.get('/tools', (req, res) => {
    res.json({
        status: 'success',
        tools: toolRegistry.listTools()
    });
});

app.post('/tools/call', async (req, res) => {
    const { name, arguments: args } = req.body || {};
    if (!name) {
        return res.status(400).json({ status: 'error', message: 'Field name wajib disertakan.' });
    }

    try {
        const result = await toolRegistry.callTool(name, args || {});
        res.json(result);
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/sync', async (req, res) => {
    try {
        const result = await GitSync.syncRepo();
        res.json(result);
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

/**
 * 3. Model Context Protocol (MCP) Standard Endpoints:
 * - GET /sse : Inisialisasi SSE connection
 * - POST /message : Mengirim JSON-RPC message
 */
app.get('/sse', (req, res) => {
    const sessionId = uuidv4();

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    res.write(`event: endpoint\ndata: /message?sessionId=${sessionId}\n\n`);

    activeSessions.set(sessionId, res);
    console.log(`[MCP Server] Klien terhubung via SSE. Session ID: ${sessionId}`);

    req.on('close', () => {
        activeSessions.delete(sessionId);
        console.log(`[MCP Server] Klien terputus. Session ID: ${sessionId}`);
    });
});

app.post('/message', async (req, res) => {
    const { sessionId } = req.query;
    const body = req.body;

    if (!body || typeof body !== 'object') {
        return res.status(400).json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
    }

    const { id, method, params } = body;

    // Helper untuk merespons JSON-RPC
    const respond = (result, error = null) => {
        const payload = { jsonrpc: '2.0', id: id ?? null };
        if (error) payload.error = error;
        else payload.result = result;

        // Jika klien punya session SSE aktif, pancarkan juga via SSE
        if (sessionId && activeSessions.has(sessionId)) {
            const clientRes = activeSessions.get(sessionId);
            clientRes.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
        }

        return res.json(payload);
    };

    console.log(`[MCP Request] Method: ${method}, id: ${id}`);

    try {
        switch (method) {
            case 'initialize':
                return respond({
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        tools: { listChanged: true }
                    },
                    serverInfo: {
                        name: 'waguri-mcp-sandbox',
                        version: '1.0.0'
                    }
                });

            case 'notifications/initialized':
                // Client konfirmasi inisialisasi selesai
                return res.status(200).end();

            case 'tools/list':
                return respond({
                    tools: toolRegistry.listTools()
                });

            case 'tools/call': {
                const { name, arguments: toolArgs } = params || {};
                const executionResult = await toolRegistry.callTool(name, toolArgs || {});
                return respond(executionResult);
            }

            case 'ping':
                return respond({});

            default:
                return respond(null, {
                    code: -32601,
                    message: `Method '${method}' tidak ditemukan.`
                });
        }
    } catch (err) {
        return respond(null, {
            code: -32603,
            message: `Internal error: ${err.message}`
        });
    }
});

// Jalankan auto-sync Git saat boot jika ada repo yang dikonfigurasi
if (process.env.TOOLS_GIT_REPO) {
    GitSync.syncRepo().catch(err => console.warn(`[GitSync] Auto-sync awal dilewati: ${err.message}`));
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Waguri MCP Sandbox Server berjalan di port ${PORT}`);
    console.log(`📡 Endpoint SSE: http://0.0.0.0:${PORT}/sse`);
    console.log(`🛠️ Terdaftar ${toolRegistry.listTools().length} alat/tools bawaan.`);
});
