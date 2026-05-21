import express from 'express';
import cors from 'cors';
import { chatWithWaguri } from './services/geminiService.js';
import { requireAuth } from './middleware/auth.js';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import os from 'os';
import multer from 'multer';
import { GoogleAIFileManager } from '@google/generative-ai/server';

dotenv.config();

import mongoose from 'mongoose';
import { getAuthUrl, saveTokens, initGoogleAuth } from './services/googleAuth.js';
import { initJantungKognitif } from './cron/jantung_kognitif.js';
import { initResetHarian } from './cron/reset_harian.js';
import { initWatchdogStatis } from './cron/watchdog_statis.js';
import { initWatchdogPrediktif } from './cron/watchdog_prediktif.js';
import { initInjeksiSholat } from './cron/injeksi_sholat.js';
import Jadwal from './models/Jadwal.js';
import ChatSession from './models/ChatSession.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Setup File Manager dan Multer
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY || "");
const upload = multer({ dest: os.tmpdir() }); // Jangan simpan di memori (RAM)

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

// Manajemen Ingatan (Sekarang dipindahkan ke MongoDB - ChatSession)

// Pelacak Token Global
let dailyTokenUsage = 0;

// Fungsi Pengumpul Metrik (Data Aggregator)
async function gatherTelemetryData() {
    const ramUsagePercent = ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;
    const cpuLoad = os.loadavg(); // [1m, 5m, 15m]
    const serverUptime = os.uptime(); // in seconds

    // Kueri Metrik Kognitif: Jadwal statis hari ini
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const matchToday = {
        tipe_jadwal: 'statis',
        waktu_eksekusi_statis: { $gte: startOfDay, $lte: endOfDay }
    };

    // Parallel count (Optimized)
    const [totalTugas, tugasSelesai] = await Promise.all([
        Jadwal.countDocuments(matchToday),
        Jadwal.countDocuments({ ...matchToday, status_selesai: true })
    ]);

    return {
        system: {
            ramUsagePercent,
            cpuLoad,
            serverUptime,
            dailyTokenUsage
        },
        cognitive: {
            totalTugasHariIni: totalTugas,
            tugasSelesaiHariIni: tugasSelesai
        }
    };
}

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
    // Ambil deviceId dari auth token/klien, atau fallback ke default
    const deviceId = socket.handshake.auth?.deviceId || 'waguri-default-device';
    console.log(`[Socket] Klien terhubung: ${socket.id} | Device: ${deviceId}`);

    // Sinkronisasi riwayat chat dengan klien ketika pertama terhubung
    socket.on('request_history', async () => {
        try {
            const session = await ChatSession.findOne({ deviceId });
            socket.emit('chat_history_sync', session ? session.history : []);
        } catch (error) {
            console.error('[Socket] Error fetch history:', error.message);
        }
    });

    // Injeksi Mesin Interval (WebSocket Emitter)
    const telemetryInterval = setInterval(async () => {
        try {
            const payload = await gatherTelemetryData();
            socket.emit('dashboard_telemetry', payload);
        } catch (error) {
            console.error(`[Telemetry] Gagal mengumpulkan data:`, error.message);
        }
    }, 30000);

    socket.on('chat_message', async (data) => {
        try {
            // Opsional: Beritahu klien bahwa AI sedang memproses/mengetik
            socket.emit('typing', { isTyping: true });

            // Mendukung data berupa string atau objek (mengandung prompt, message, atau text)
            const prompt = typeof data === 'string' ? data : (data?.prompt || data?.message || data?.text);
            const attachment = typeof data === 'string' ? null : data?.attachment;

            // Ambil riwayat obrolan dari MongoDB (Server-side Persistence)
            let session = await ChatSession.findOne({ deviceId });
            if (!session) {
                session = new ChatSession({ deviceId, history: [] });
            }
            let history = session.history;

            if (!prompt && !attachment) {
                return socket.emit('chat_reply', { status: 'error', message: 'Pesan tidak boleh kosong' });
            }

            console.log(`[Socket][${socket.id}] Menerima pesan dari klien.`);

            // Cek apakah ada attachment
            let userParts = [];
            if (prompt) {
                userParts.push({ text: prompt });
            } else {
                userParts.push({ text: "Tolong analisis media ini." });
            }

            if (attachment && attachment.fileUri && attachment.mimeType) {
                userParts.push({
                    fileData: {
                        fileUri: attachment.fileUri,
                        mimeType: attachment.mimeType
                    }
                });
            }

            // Teruskan ke fungsi logika utama Gemini
            const result = await chatWithWaguri(userParts, history);

            // Perbarui riwayat dengan hasil dari SDK yang sudah terstruktur rapi (termasuk function calls)
            let newHistory = result.history || [];

            // Simpan ke riwayat memori (Sliding Window: maks 15 pesan, sesuai permintaan)
            while (newHistory.length > 15) {
                newHistory.shift();
                // Hukum Mutlak Gemini: Elemen pertama riwayat HARUS selalu role 'user'
                while (newHistory.length > 0 && newHistory[0].role !== 'user') {
                    newHistory.shift();
                }
            }
            
            // Simpan kembali ke MongoDB
            session.history = newHistory;
            await session.save();

            // Perbarui pelacak token global
            if (result.tokenUsage && result.tokenUsage.totalTokens) {
                dailyTokenUsage += result.tokenUsage.totalTokens;
            }

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

    // Mekanisme Sapu Bersih (Manual By User)
    socket.on('clear_context', async () => {
        console.log(`[Socket][${socket.id}] Membersihkan konteks obrolan untuk device: ${deviceId}`);
        await ChatSession.findOneAndUpdate({ deviceId }, { history: [] });
        socket.emit('chat_history_sync', []); // Beritahu klien bahwa riwayat telah kosong
    });

    socket.on('disconnect', () => {
        console.log(`[Socket] Klien terputus: ${socket.id} | Device: ${deviceId}`);
        clearInterval(telemetryInterval); // Hukum Mutlak Pencegahan Kebocoran Memori
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

// Pembuatan Endpoint Ingesti (HTTP POST) untuk Multimodal
app.post('/api/upload-media', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'Tidak ada fail yang diunggah' });
    }

    const filePath = req.file.path;
    const mimeType = req.file.mimetype;
    const displayName = req.file.originalname;

    try {
        const uploadResult = await fileManager.uploadFile(filePath, {
            mimeType,
            displayName,
        });

        res.json({
            success: true,
            fileUri: uploadResult.file.uri,
            mimeType: uploadResult.file.mimeType
        });
    } catch (error) {
        console.error('Error uploading file to Gemini:', error);
        res.status(500).json({ success: false, error: 'Gagal mengunggah fail ke infrastruktur Google' });
    } finally {
        // Hukum Mutlak: Segera setelah uploadFile selesai, eksekusi fs.unlinkSync untuk mencegah memory leak di VPS
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
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

        // Perbarui pelacak token global
        if (result.tokenUsage && result.tokenUsage.totalTokens) {
            dailyTokenUsage += result.tokenUsage.totalTokens;
        }

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
