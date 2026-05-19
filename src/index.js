import express from 'express';
import cors from 'cors';
import { chatWithWaguri } from './services/geminiService.js';
import { requireAuth } from './middleware/auth.js';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';

dotenv.config();

import mongoose from 'mongoose';
import { getAuthUrl, saveTokens, initGoogleAuth } from './services/googleAuth.js';
import { initJantungKognitif } from './cron/jantung_kognitif.js';
import { initResetHarian } from './cron/reset_harian.js';
import { initWatchdogStatis } from './cron/watchdog_statis.js';
import { initWatchdogPrediktif } from './cron/watchdog_prediktif.js';
import { initInjeksiSholat } from './cron/injeksi_sholat.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Koneksi ke MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/waguri_db';
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Terhubung ke MongoDB'))
    .catch((err) => console.error('❌ Gagal terhubung ke MongoDB:', err));

// Buat HTTP server untuk menggabungkan Express dan Socket.io
const httpServer = createServer(app);

// Inisialisasi Socket.io dengan CORS configuration
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Pada produksi, sesuaikan dengan domain klien (misalnya URL React Native/Android)
        methods: ["GET", "POST"]
    }
});

// Lapisan Keamanan Socket.io (Otentikasi Token)
io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token && token === process.env.API_SECRET_TOKEN) {
        return next();
    }
    const err = new Error("Authentication error: Token tidak valid atau tidak disediakan");
    console.log(`[Socket] Koneksi ditolak (Autentikasi gagal): ${socket.id}`);
    return next(err);
});

// Event Listener Socket.io
io.on('connection', (socket) => {
    console.log(`[Socket] Klien terhubung: ${socket.id}`);

    // Event saat menerima pesan teks dari klien
    socket.on('chat_message', async (data) => {
        try {
            // Opsional: Beritahu klien bahwa AI sedang memproses/mengetik
            socket.emit('typing', { isTyping: true });

            // Mendukung data berupa string atau objek (mengandung prompt dan history)
            const prompt = typeof data === 'string' ? data : data.prompt;
            const history = data.history || [];

            if (!prompt) {
                return socket.emit('chat_reply', { status: 'error', message: 'Prompt tidak boleh kosong' });
            }

            console.log(`[Socket][${socket.id}] Menerima pesan: "${prompt}"`);

            // Teruskan ke fungsi logika utama Gemini
            const result = await chatWithWaguri(prompt, history);

            // Kirimkan balasan kembali ke klien
            socket.emit('chat_reply', {
                status: "success",
                response: result.text,
                tokenUsage: result.tokenUsage
            });

        } catch (error) {
            console.error(`[Socket][${socket.id}] Error:`, error.message);
            socket.emit('chat_reply', {
                status: "error",
                message: "Terjadi kesalahan pada server",
                error: error.message
            });
        } finally {
            // Hentikan status "typing" setelah proses selesai
            socket.emit('typing', { isTyping: false });
        }
    });

    socket.on('disconnect', () => {
        console.log(`[Socket] Klien terputus: ${socket.id}`);
    });
});
await initGoogleAuth();
// Inisialisasi mesin cron Jantung Kognitif
initJantungKognitif(io);

// Inisialisasi mesin cron Reset Tengah Malam (Rutinitas Harian)
initResetHarian();

// Inisialisasi mesin cron Watchdog Statis (Alarm Jadwal Pasti)
initWatchdogStatis(io);

// Inisialisasi mesin cron Watchdog Prediktif (Peringatan Lalu Lintas)
initWatchdogPrediktif(io);

// Inisialisasi mesin cron Injeksi Sholat Harian
initInjeksiSholat();

app.use(cors());
app.use(express.json());

// Endpoint dasar untuk cek status server
app.get('/', (req, res) => {
    res.send('Waguri AI Server is running.');
});

app.get('/api/auth/google', (req, res) => {
    res.redirect(getAuthUrl());
});

// Rute Callback (Target dari Redirect URI yang kamu set di Google Cloud)
app.get('/api/auth/google/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('Kode otorisasi tidak ditemukan.');

    try {
        await saveTokens(code);
        res.send(`
                <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                    <h1 style="color: #4CAF50;">✅ Otorisasi Mutlak Berhasil</h1>
                    <p>Waguri sekarang memiliki hak akses ke Google Workspace Anda.</p>
                    <p>Silakan tutup jendela ini dan kembali ke terminal.</p>
                </div>
            `);
    } catch (error) {
        console.error('Error saat menyimpan token:', error);
        res.status(500).send('Gagal mengamankan token Google.');
    }
});
// Middleware autentikasi untuk REST API
app.use(requireAuth);

// Endpoint utama REST API tetap dipertahankan
app.post('/api/chat', async (req, res) => {
    try {
        const { prompt, history } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: "Prompt tidak boleh kosong" });
        }

        console.log(`[REST] Menerima pesan: "${prompt}"`);
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
// Rute untuk memulai proses Login Google

httpServer.listen(PORT, () => {
    console.log(`=====================================`);
    console.log(`🤖 Waguri AI Server berjalan di port ${PORT}`);
    console.log(`📡 REST API siap di http://localhost:${PORT}/api/chat`);
    console.log(`🔌 Socket.io siap menerima koneksi secara real-time`);
    console.log(`=====================================`);
});
