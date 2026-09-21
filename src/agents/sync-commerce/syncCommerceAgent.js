import fs from 'fs';
import path from 'path';
import { eventBus } from '../../core/bus/eventBus.js';
import { TOPICS } from '../../core/bus/topics.js';
import { createAgentLogger } from '../../core/logger/index.js';

const logger = createAgentLogger('ContentAndCommerce');

export class SyncCommerceAgent {
    constructor() {
        this.wikiDir = process.env.WIKI_CONTENT_DIR || path.join(process.cwd(), 'shared', 'wiki_content');
        if (!fs.existsSync(this.wikiDir)) {
            fs.mkdirSync(this.wikiDir, { recursive: true });
        }
    }

    async init() {
        logger.info('Menginisialisasi Subagen Content Sync & E-Commerce Analytics...');

        // Dengarkan event sinkronisasi markdown catatan obrolan
        await eventBus.subscribe(TOPICS.COMMERCE.SYNC_MARKDOWN, async (event) => {
            const { filename, title, content, category } = event.payload || {};
            await this.writeMarkdownFile(filename, title, content, category);
        });

        // Dengarkan webhook transaksi toko online
        await eventBus.subscribe(TOPICS.COMMERCE.TRANSACTION_WEBHOOK, async (event) => {
            const { orderId, amount, items, customerName } = event.payload || {};
            logger.info({ orderId, amount, customerName }, 'Menerima transaksi toko online baru.');

            // Kirim ringkasan transaksi ke The Archivist untuk memori permanen
            await eventBus.publish(TOPICS.MEMORY.INGEST_FACT, {
                sourceAgent: 'ContentAndCommerce',
                action: 'STORE_TRANSACTION',
                payload: {
                    content: `Transaksi berhasil di Revanda Store: Order ${orderId}, Nilai: Rp${Number(amount).toLocaleString('id-ID')} oleh ${customerName}.`,
                    category: 'E-Commerce_Transaction',
                    tags: ['transaksi', 'toko_online', orderId]
                }
            });
        });

        // Handler RPC untuk ringkasan pasar / bisnis
        await eventBus.subscribe(TOPICS.COMMERCE.MARKET_SUMMARY, async (event) => {
            if (event.replyTo && event.correlationId) {
                await eventBus.respond(event.replyTo, event.correlationId, 'ContentAndCommerce', {
                    status: 'success',
                    data: {
                        summary: 'Aktivitas bisnis berjalan stabil. Sistem transaksi revandastore terpantau normal.'
                    }
                });
            }
        });

        logger.info('✅ Content & Commerce Subagent siap.');
    }

    /**
     * Tulis berkas markdown (.md) ke shared volume untuk wiki web/game
     */
    async writeMarkdownFile(filename, title, content, category = 'General') {
        try {
            const safeName = (filename || `note_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
            const targetPath = path.join(this.wikiDir, `${safeName}.md`);

            const fileContent = `---
title: "${title || safeName}"
category: "${category}"
date: "${new Date().toISOString()}"
author: "Waguri Second Brain"
---

# ${title || safeName}

${content}
`;
            fs.writeFileSync(targetPath, fileContent, 'utf-8');
            logger.info({ targetPath }, 'Berkas Markdown berhasil disinkronkan ke shared volume wiki.');
        } catch (err) {
            logger.error({ err: err.message }, 'Gagal menulis berkas Markdown ke wiki');
        }
    }
}

export const syncCommerceAgent = new SyncCommerceAgent();
