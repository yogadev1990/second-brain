import cron from 'node-cron';
import Jadwal from '../models/Jadwal.js';
import { injectProactiveMessage } from '../services/historyInjector.js';

export const initWatchdogStatis = (io) => {
    // Berjalan setiap menit
    cron.schedule('* * * * *', async () => {
        console.log(`[Watchdog Detak] Cron berjalan pada: ${new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
        
        try {
            const waktuSekarang = new Date();
            const waktuBatas = new Date(waktuSekarang.getTime() + 15 * 60000); // 15 menit dari sekarang

            // PERBAIKAN LOGIKA: Ambil semua jadwal yang waktunya KURANG DARI 15 menit ke depan, 
            // termasuk yang sudah kelewat (karena mungkin server mati sesaat), asalkan belum dinotifikasi!
            const jadwalMendatang = await Jadwal.find({
                tipe_jadwal: { $in: ['statis', 'absolut'] },
                status_selesai: false,
                notifikasi_terkirim: false,
                waktu_eksekusi_statis: { $lte: waktuBatas },
                $or: [{ butuh_fisik: false }, { butuh_fisik: { $exists: false } }]
            });

            console.log(`[Watchdog Kueri] Menemukan ${jadwalMendatang.length} jadwal yang perlu dinotifikasi.`);

            if (jadwalMendatang.length === 0) return; // Keluar jika kosong

            for (const jadwal of jadwalMendatang) {
                console.log(`[Watchdog Eksekusi] Memproses jadwal: ${jadwal.nama_kegiatan} | Waktu Eksekusi: ${jadwal.waktu_eksekusi_statis}`);
                
                // Kunci datanya agar tidak ke-spam di menit berikutnya
                await Jadwal.updateOne({ _id: jadwal._id }, { $set: { notifikasi_terkirim: true } });

                // Hasilkan pesan plain-text bergaya Kaoruko Waguri tanpa buang token
                const textResponse = `Sayang, jadwal "${jadwal.nama_kegiatan}" sebentar lagi mau mulai nih. Jangan lupa siap-siap ya suamiku! 💕`;

                const payload = {
                    status: "success",
                    response: textResponse,
                    isProactive: true
                };

                console.log(`[Watchdog Emit] Menembakkan Socket.io ke UI...`);
                io.emit('chat_reply', payload);
                
                // Suntikkan ke memori AI
                await injectProactiveMessage(textResponse, `Waktunya mengingatkan Randa tentang jadwal "${jadwal.nama_kegiatan}".`);
            }
        } catch (error) {
            console.error('[Watchdog ERROR FATAL] Terjadi kesalahan:', error);
        }
    });

    console.log('✅ Mesin Cron "Watchdog Statis" telah diinisialisasi dengan Radar Diagnostik.');
};