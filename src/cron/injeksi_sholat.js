import cron from 'node-cron';
import axios from 'axios';
import Jadwal from '../models/Jadwal.js';

/**
 * Injeksi Waktu Sholat Harian
 * 
 * Menarik jadwal sholat wajib dari API Aladhan (Kemenag RI method 11),
 * lalu meng-upsert ke koleksi Jadwal sebagai tipe 'absolut'.
 * Dijalankan setiap hari jam 00:05 WIB agar jadwal hari ini selalu tersedia
 * sebelum Subuh (~04:30).
 */

const NAMA_SHOLAT_MAP = {
    Fajr: 'Subuh',
    Dhuhr: 'Dzuhur',
    Asr: 'Ashar',
    Maghrib: 'Maghrib',
    Isha: 'Isya'
};

export const injeksiWaktuSholat = async () => {
    try {
        const response = await axios.get('http://api.aladhan.com/v1/timingsByCity', {
            params: { city: 'Palembang', country: 'Indonesia', method: 11 } // Method 11: Kemenag RI
        });

        const timings = response.data.data.timings;
        const sholatWajib = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
        const tanggalHariIni = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }); // Format: YYYY-MM-DD, dipaksa WIB

        for (const waktu of sholatWajib) {
            const namaLokal = NAMA_SHOLAT_MAP[waktu];
            // Konversi waktu string (misal "12:15") ke objek Date absolut WIB
            const waktuIso = new Date(`${tanggalHariIni}T${timings[waktu]}:00+07:00`);
            const idTugas = `sholat_${waktu.toLowerCase()}_${tanggalHariIni}`;

            await Jadwal.findOneAndUpdate(
                { id_tugas: idTugas },
                { 
                    id_tugas: idTugas,
                    nama_kegiatan: `Sholat ${namaLokal}`, 
                    tipe_jadwal: 'absolut', 
                    waktu_eksekusi_statis: waktuIso,
                    butuh_fisik: false,
                    status_selesai: false,
                    notifikasi_terkirim: false
                },
                { upsert: true, returnDocument: 'after' }
            );
        }
        console.log(`✅ [Sholat] 5 waktu sholat absolut berhasil diinjeksi untuk ${tanggalHariIni}.`);
    } catch (error) {
        console.error('❌ [Sholat] Gagal menarik API Sholat:', error.message);
    }
};

export const initInjeksiSholat = () => {
    // Jalankan sekali saat server boot
    injeksiWaktuSholat();

    // Lalu jadwalkan setiap hari jam 00:05 WIB
    cron.schedule('5 0 * * *', async () => {
        console.log('[Cron Sholat] Menginjeksi jadwal sholat hari baru...');
        await injeksiWaktuSholat();
    }, {
        timezone: 'Asia/Jakarta'
    });

    console.log('✅ Mesin Cron "Injeksi Sholat" telah diinisialisasi (harian jam 00:05 WIB + saat boot).');
};
