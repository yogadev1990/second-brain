import cron from 'node-cron';
import Jadwal from '../models/Jadwal.js';
import { chatWithWaguri } from '../services/geminiService.js';

export const initJantungKognitif = (io) => {
    // Jalankan setiap hari jam 08:00 pagi dan 16:00 sore (waktu server)
    // Ekspresi cron: 0 8,16 * * *
    cron.schedule('0 8,16 * * *', async () => {
        console.log('[Cron] Memulai evaluasi Jantung Kognitif (Proactive AI)...');
        try {
            // Lakukan query untuk tipe_jadwal: 'kuota_fleksibel' yang belum tercapai
            const jadwalTertunda = await Jadwal.find({
                tipe_jadwal: 'kuota_fleksibel',
                $expr: { $lt: ["$durasi_tercapai_menit", "$target_durasi_menit"] }
            });

            if (jadwalTertunda.length === 0) {
                console.log('[Cron] Tidak ada target kuota fleksibel yang belum terpenuhi.');
                return;
            }

            // Rangkum data
            const rangkuman = jadwalTertunda.map(j => {
                const sisa = j.target_durasi_menit - j.durasi_tercapai_menit;
                return `- ${j.nama_kegiatan}: sisa ${sisa} menit minggu ini.`;
            }).join('\n');

            console.log(`[Cron] Rangkuman jadwal tertunda:\n${rangkuman}`);

            // Instruksi tak terlihat untuk Gemini
            const hiddenPrompt = `
Instruksi Sistem (PENTING): Berperanlah sebagai asisten proaktif. Pengguna memiliki target kuota yang belum terpenuhi. Buat pesan singkat dan natural untuk mengingatkan pengguna agar menyelesaikan targetnya hari ini, tawarkan bantuan untuk memblokir waktu luangnya.

Berikut adalah rangkuman jadwal yang belum terpenuhi:
${rangkuman}
            `.trim();

            // Panggil Gemini API
            const result = await chatWithWaguri(hiddenPrompt, []);

            // Eksekusi WebSocket: kirimkan balasan ke semua client
            // Jika Anda hanya ingin mengirim ke pengguna tertentu, Anda butuh manajemen socket_id
            io.emit('chat_reply', {
                status: "success",
                text: result.text,
                isProactive: true // penanda bahwa pesan ini proaktif dari server
            });

            console.log('[Cron] Berhasil mengirim notifikasi proaktif ke klien.');
        } catch (error) {
            console.error('[Cron] Terjadi kesalahan saat menjalankan evaluasi Jantung Kognitif:', error);
        }
    });

    console.log('✅ Mesin Cron "Jantung Kognitif" telah diinisialisasi.');
};
