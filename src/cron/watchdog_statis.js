import cron from 'node-cron';
import Jadwal from '../models/Jadwal.js';
import { injectProactiveMessage } from '../services/historyInjector.js';

export const initWatchdogStatis = (io) => {
    // Berjalan setiap menit
    cron.schedule('* * * * *', async () => {
        console.log(`[Watchdog Detak] Cron berjalan pada: ${new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
        
        try {
            const waktuSekarang = new Date();
            const waktuBatas = new Date(waktuSekarang.getTime() + 15 * 60000); // 15 menit ke depan
            const waktuMinimal = new Date(waktuSekarang.getTime() - 15 * 60000); // Batas toleransi 15 menit ke belakang

            // 1. SILENT AUTO-EXPIRE: Tandai selesai jadwal-jadwal lampau yang sudah lewat lebih dari 15 menit
            // agar tidak terjadi pemboman notifikasi saat kontainer baru selesai restart.
            await Jadwal.updateMany({
                tipe_jadwal: { $in: ['statis', 'absolut'] },
                status_selesai: false,
                notifikasi_terkirim: false,
                waktu_eksekusi_statis: { $lt: waktuMinimal }
            }, {
                $set: { notifikasi_terkirim: true, status_selesai: true }
            });

            // 2. Ambil hanya jadwal yang benar-benar relevan saat ini (rentang waktu: -15 menit s/d +15 menit)
            const jadwalMendatang = await Jadwal.find({
                tipe_jadwal: { $in: ['statis', 'absolut'] },
                status_selesai: false,
                notifikasi_terkirim: false,
                waktu_eksekusi_statis: { $gte: waktuMinimal, $lte: waktuBatas },
                $or: [{ butuh_fisik: false }, { butuh_fisik: { $exists: false } }]
            });

            if (jadwalMendatang.length === 0) return; // Keluar jika kosong

            console.log(`[Watchdog Kueri] Menemukan ${jadwalMendatang.length} jadwal aktif yang perlu dinotifikasi.`);

            for (const jadwal of jadwalMendatang) {
                console.log(`[Watchdog Eksekusi] Memproses jadwal: ${jadwal.nama_kegiatan} | Waktu Eksekusi: ${jadwal.waktu_eksekusi_statis}`);
                
                // Kunci datanya agar tidak ke-spam di menit berikutnya
                await Jadwal.updateOne({ _id: jadwal._id }, { $set: { notifikasi_terkirim: true } });

                // Format teks pengingat Waguri yang santun, lembut, dan bersahaja (anti-alay)
                let textResponse;
                if (jadwal.nama_kegiatan.toLowerCase().includes('sholat')) {
                    textResponse = `Mas Yoga, sebentar lagi masuk waktu ${jadwal.nama_kegiatan}. Kalau senggang, yuk bersiap-siap sholat dulu ya...`;
                } else {
                    textResponse = `Mas Yoga, jadwal "${jadwal.nama_kegiatan}" sebentar lagi mau dimulai ya. Jangan lupa bersiap-siap...`;
                }

                const payload = {
                    status: "success",
                    response: textResponse,
                    isProactive: true,
                    type: "SCHEDULE_REMINDER"
                };

                console.log(`[Watchdog Emit] Menembakkan Socket.io ke UI...`);
                io.emit('chat_reply', payload);
                
                // Suntikkan ke memori AI
                await injectProactiveMessage(textResponse, `Waktunya mengingatkan Mas Yoga tentang jadwal "${jadwal.nama_kegiatan}".`);
            }
        } catch (error) {
            console.error('[Watchdog ERROR FATAL] Terjadi kesalahan:', error);
        }
    });

    console.log('✅ Mesin Cron "Watchdog Statis" telah diinisialisasi dengan Radar Diagnostik.');
};