import cron from 'node-cron';
import Jadwal from '../models/Jadwal.js';
import { chatWithWaguri } from '../services/geminiService.js';

export const initWatchdogStatis = (io) => {
    // Berjalan setiap menit
    cron.schedule('* * * * *', async () => {
        try {
            const waktuSekarang = new Date();
            const waktuBatas = new Date(waktuSekarang.getTime() + 15 * 60000); // 15 menit dari sekarang

            // Cari jadwal statis yang akan datang dalam 15 menit ke depan, belum selesai, dan belum dinotifikasi
            const jadwalMendatang = await Jadwal.find({
                tipe_jadwal: 'statis',
                status_selesai: false,
                notifikasi_terkirim: false,
                waktu_eksekusi_statis: { $gte: waktuSekarang, $lte: waktuBatas }
            });

            if (jadwalMendatang.length === 0) return;

            for (const jadwal of jadwalMendatang) {
                // Update status notifikasi agar tidak terkirim dua kali
                await Jadwal.updateOne({ _id: jadwal._id }, { $set: { notifikasi_terkirim: true } });

                console.log(`[Watchdog] Ditemukan jadwal statis segera: ${jadwal.nama_kegiatan}`);

                // Instruksi sistem proaktif
                const hiddenPrompt = `
Instruksi Sistem (PENTING): Berperanlah sebagai asisten proaktif. Beritahu pengguna bahwa jadwal '${jadwal.nama_kegiatan}' akan segera dimulai dalam waktu kurang dari 15 menit. Buat pesannya singkat, mendesak, dan natural.
                `.trim();

                const result = await chatWithWaguri(hiddenPrompt, []);

                io.emit('chat_reply', {
                    status: "success",
                    response: result.text,
                    isProactive: true
                });

                console.log(`[Watchdog] Pesan proaktif untuk ${jadwal.nama_kegiatan} berhasil dikirim.`);
            }
        } catch (error) {
            console.error('[Watchdog] Terjadi kesalahan saat memeriksa jadwal statis:', error);
        }
    });

    console.log('✅ Mesin Cron "Watchdog Statis" telah diinisialisasi.');
};
