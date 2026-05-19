import cron from 'node-cron';
import Jadwal from '../models/Jadwal.js';

export const initResetHarian = () => {
    // Jalankan tepat pada pukul 00:00 setiap harinya
    cron.schedule('0 0 * * *', async () => {
        console.log('[Cron] Memulai Reset Tengah Malam untuk rutinitas harian...');
        try {
            // Mengeksekusi operasi massal untuk mereset status_selesai
            const result = await Jadwal.updateMany(
                { siklus_reset: 'harian' },
                { $set: { status_selesai: false } }
            );

            console.log(`[Cron] Rutinitas harian berhasil di-reset untuk menyambut hari baru. Sebanyak ${result.modifiedCount} jadwal harian telah di-reset.`);
        } catch (error) {
            console.error('[Cron] Terjadi kesalahan saat melakukan Reset Tengah Malam:', error);
        }
    });

    console.log('✅ Mesin Cron "Reset Tengah Malam" telah diinisialisasi.');
};
