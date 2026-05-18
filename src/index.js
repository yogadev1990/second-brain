import express from 'express';
import { chatWithWaguri } from './services/geminiService.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Endpoint utama untuk interaksi dengan Waguri
app.post('/api/chat', async (req, res) => {
    try {
        const { prompt, history } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: "Prompt tidak boleh kosong" });
        }

        console.log(`[Request] Menerima pesan: "${prompt}"`);
        const result = await chatWithWaguri(prompt, history || []);
        
        res.json({
            status: "success",
            response: result.text,
            tokenUsage: result.tokenUsage
        });
    } catch (error) {
        res.status(500).json({
            status: "error",
            message: "Terjadi kesalahan pada server",
            error: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`=====================================`);
    console.log(`🤖 Waguri AI Server berjalan di port ${PORT}`);
    console.log(`📡 Menunggu request pada http://localhost:${PORT}/api/chat`);
    console.log(`=====================================`);
});
