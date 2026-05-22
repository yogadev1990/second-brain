import cron from 'node-cron';
import ServerMetrics from '../models/ServerMetrics.js';

export function initResetBulanan() {
    // Berjalan setiap tanggal 1 jam 00:00 (Awal Bulan) waktu Jakarta
    cron.schedule('0 0 1 * *', async () => {
        console.log(`[Cron Bulanan] Memulai reset metrik bulanan...`);
        try {
            await ServerMetrics.findOneAndUpdate(
                { type: 'global' },
                { monthlyTokenUsage: 0 },
                { upsert: true }
            );
            console.log(`[Cron Bulanan] Token bulanan berhasil di-reset ke 0.`);
        } catch (error) {
            console.error(`[Cron Bulanan] Gagal mereset token bulanan:`, error.message);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Jakarta"
    });
    console.log(`⏰ Mesin Cron Reset Bulanan (Token) diaktifkan.`);
}
