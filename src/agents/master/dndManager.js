import mongoose from 'mongoose';
import { createAgentLogger } from '../../core/logger/index.js';

const logger = createAgentLogger('DNDManager');

// Schema MongoDB Outbox Pattern untuk notifikasi tertunda selama jam DND
const OutboxNotificationSchema = new mongoose.Schema({
    userId: { type: String, default: 'yoga' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    priority: { type: String, enum: ['LOW', 'NORMAL', 'CRITICAL'], default: 'NORMAL' },
    status: { type: String, enum: ['PENDING', 'DELIVERED'], default: 'PENDING' },
    createdAt: { type: Date, default: Date.now }
});

export const OutboxNotification = mongoose.models.OutboxNotification || mongoose.model('OutboxNotification', OutboxNotificationSchema);

export class DNDManager {
    /**
     * Mengecek apakah saat ini berada dalam rentang Do Not Disturb (23:00 - 05:00 WIB Palembang)
     * @returns {boolean}
     */
    static isUnderDND() {
        const jakartaHourStr = new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Jakarta',
            hour: 'numeric',
            hour12: false
        }).format(new Date());

        const currentHour = parseInt(jakartaHourStr, 10);
        // Rentang DND: 23:00 malam sampai 04:59 fajar
        return currentHour >= 23 || currentHour < 5;
    }

    /**
     * Menyaring notifikasi keluar:
     * - Jika bukan jam DND atau prioritas CRITICAL: langsung tembus.
     * - Jika jam DND dan prioritas NORMAL/LOW: masukkan ke MongoDB Outbox.
     * 
     * @param {Object} notif
     * @param {string} notif.title
     * @param {string} notif.message
     * @param {'LOW'|'NORMAL'|'CRITICAL'} [notif.priority='NORMAL']
     * @param {Function} dispatchImmediateCallback - Callback kirim instan ke Socket/Layar
     */
    static async filterAndDispatch(notif, dispatchImmediateCallback) {
        const inDND = this.isUnderDND();
        const priority = notif.priority || 'NORMAL';

        if (!inDND || priority === 'CRITICAL') {
            logger.info({ title: notif.title, priority }, 'Notifikasi diizinkan terkirim instan.');
            return await dispatchImmediateCallback();
        }

        // Sedang dalam jam istirahat: Simpan ke Outbox
        logger.info({ title: notif.title }, '🌙 Mode DND Aktif (23:00-05:00 WIB): Notifikasi disimpan ke Outbox MongoDB.');
        await OutboxNotification.create({
            title: notif.title,
            message: notif.message,
            priority: priority,
            status: 'PENDING'
        });
    }

    /**
     * Mengosongkan antrean Outbox saat fajar tiba (dipanggil tepat pukul 05:01 WIB)
     * @param {Function} emitBatchCallback
     */
    static async flushOutbox(emitBatchCallback) {
        try {
            const pendingList = await OutboxNotification.find({ status: 'PENDING' }).sort({ createdAt: 1 });
            if (pendingList.length === 0) return;

            logger.info({ count: pendingList.length }, '🌅 DND Berakhir: Mengirimkan kumpulan notifikasi tertunda dari Outbox...');
            await emitBatchCallback(pendingList);

            await OutboxNotification.updateMany(
                { _id: { $in: pendingList.map(item => item._id) } },
                { $set: { status: 'DELIVERED' } }
            );
        } catch (err) {
            logger.error({ err: err.message }, 'Gagal mengosongkan Outbox DND');
        }
    }
}
