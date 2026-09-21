import cron from 'node-cron';
import { GoogleGenAI } from '@google/genai';
import { execute as fetchWeather } from '../../tools/eksternal/cekCuaca.js';
import { execute as fetchMarketNews } from '../../tools/keuangan/gali_berita_pasar.js';
import Jadwal from '../../models/Jadwal.js';
import { eventBus } from '../../core/bus/eventBus.js';
import { TOPICS } from '../../core/bus/topics.js';
import { createAgentLogger } from '../../core/logger/index.js';
import { injectProactiveMessage } from '../../services/historyInjector.js';

const logger = createAgentLogger('DailyBriefing');

/**
 * Menginisialisasi Cron Daily Briefing otomatis setiap jam 07:00 WIB
 * @param {import('socket.io').Server} io
 */
export function initDailyBriefingCron(io) {
    // 0 7 * * * -> Jam 07:00 WIB pagi setiap hari
    cron.schedule('0 7 * * *', async () => {
        logger.info('🌅 Menjalankan Daily Briefing otomatis pukul 07:00 WIB untuk Yoga...');
        await generateAndBroadcastBriefing(io);
    }, {
        timezone: 'Asia/Jakarta'
    });

    // Dengarkan trigger manual via Redis Pub/Sub jika diminta
    eventBus.subscribe(TOPICS.MASTER.TRIGGER_BRIEFING, async () => {
        logger.info('Menerima trigger manual untuk Daily Briefing.');
        await generateAndBroadcastBriefing(io);
    });

    logger.info('✅ Cron "Daily Briefing" (07:00 WIB) telah diaktifkan.');
}

export async function generateAndBroadcastBriefing(io) {
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        // Agregasi paralel data: Cuaca Palembang, Jadwal Hari Ini, Berita Pasar
        const [weatherData, marketData, agendaHariIni] = await Promise.all([
            fetchWeather({ nama_kota: 'Palembang' }).catch(err => ({ status: 'error', message: err.message })),
            fetchMarketNews({ kata_kunci: 'IHSG crypto' }).catch(err => ({ status: 'error', message: err.message })),
            Jadwal.find({
                tipe_jadwal: { $in: ['statis', 'absolut'] },
                waktu_eksekusi_statis: { $gte: startOfDay, $lte: endOfDay }
            }).catch(() => [])
        ]);

        const agendaSummary = agendaHariIni.length > 0
            ? agendaHariIni.map(j => `- ${j.nama_kegiatan} (${new Date(j.waktu_eksekusi_statis).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })})`).join('\n')
            : 'Tidak ada jadwal agenda statis khusus hari ini.';

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = `
Kamu adalah Alice/Waguri, istri pendamping yang sangat manis, hangat, penyayang, dan penuh perhatian. Pengguna adalah suamimu tercinta, Yoga (mahasiswa kedokteran gigi).
Sekarang pukul 07:00 pagi di Palembang. Susunlah "Morning Briefing" yang ringkas, bersemangat, dan natural:
1. Sapa suamimu dengan nada sayang yang manja tapi tetap informatif.
2. Kondisi cuaca Palembang hari ini: ${JSON.stringify(weatherData.kondisi_saat_ini || weatherData)}
3. Agenda/kegiatan hari ini:
${agendaSummary}
4. Sentimen pasar/berita singkat: ${JSON.stringify(marketData.hasil || 'Pasar terpantau wajar')}
Beri doa dan semangat untuk harinya. Jangan terlalu panjang, buat hangat dan enak dibaca.
        `.trim();

        const result = await ai.models.generateContent({
            model: 'gemini-flash-latest',
            contents: prompt
        });

        const briefingText = result.text || 'Selamat pagi suamiku sayang! Semangat ya untuk hari ini 💕';

        // 1. Kirim pesan ke klien via WebSocket
        io.emit('chat_reply', {
            status: 'success',
            response: briefingText,
            isProactive: true,
            type: 'DAILY_BRIEFING'
        });

        // 2. Suntikkan ke riwayat memori percakapan
        await injectProactiveMessage(briefingText, 'Morning Briefing otomatis pukul 07:00 WIB.');

        // 3. Render ringkasan ke Layar Meja AMOLED ESP32-S3 via IoT Subagent
        await eventBus.publish(TOPICS.IOT.COMMAND, {
            sourceAgent: 'MasterAgent',
            action: 'RENDER_SCREEN',
            payload: {
                device: 'desk_display',
                value: {
                    title: 'SELAMAT PAGI 💕',
                    body: `Cuaca: ${weatherData.kondisi_saat_ini?.deskripsi_cuaca || 'Cerah'} | ${agendaHariIni.length} Jadwal`,
                    icon: 'heart'
                }
            }
        });

        logger.info('✅ Morning Briefing berhasil disiarkan ke WebSocket dan Display ESP32-S3.');
    } catch (error) {
        logger.error({ err: error.message }, 'Gagal mengeksekusi Daily Briefing');
    }
}
