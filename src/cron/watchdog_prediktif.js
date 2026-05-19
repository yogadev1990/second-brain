import cron from 'node-cron';
import Jadwal from '../models/Jadwal.js';
import { chatWithWaguri } from '../services/geminiService.js';

/**
 * Watchdog Prediktif — Memantau jadwal yang butuh kehadiran fisik.
 * 
 * Logika:
 * 1. Setiap 5 menit, kueri semua jadwal statis yang butuh_fisik=true dan
 *    waktunya dalam 90 menit ke depan, yang belum ditandai peringatan_macet_terkirim.
 * 2. Untuk setiap jadwal yang ditemukan, panggil Google Maps Distance Matrix API
 *    untuk mengecek estimasi waktu tempuh dari lokasi pengguna ke lokasi tujuan.
 * 3. Jika terdeteksi kemacetan (durasi_in_traffic > durasi_normal * 1.3) atau
 *    sudah waktunya bersiap-siap, kirim peringatan proaktif via Socket.io.
 */

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
// Koordinat default rumah/lokasi pengguna (atur di .env)
const ORIGIN_COORDS = process.env.USER_HOME_COORDS || '-6.2000,106.8166';

/**
 * Memanggil Google Maps Distance Matrix API untuk mendapatkan estimasi waktu tempuh.
 * Mengembalikan objek { durasiNormalDetik, durasiMacetDetik, jarakTeks, durasiTeks }
 */
const cekWaktuTempuh = async (origin, destination) => {
    try {
        const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
        url.searchParams.set('origins', origin);
        url.searchParams.set('destinations', destination);
        url.searchParams.set('departure_time', 'now');
        url.searchParams.set('traffic_model', 'best_guess');
        url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

        const response = await fetch(url.toString());
        const data = await response.json();

        if (data.status !== 'OK' || !data.rows?.[0]?.elements?.[0]) {
            console.error('[Watchdog Prediktif] ❌ Google Maps API error:', data.status);
            return null;
        }

        const element = data.rows[0].elements[0];
        if (element.status !== 'OK') {
            console.error('[Watchdog Prediktif] ❌ Rute tidak ditemukan:', element.status);
            return null;
        }

        return {
            durasiNormalDetik: element.duration.value,
            durasiMacetDetik: element.duration_in_traffic?.value || element.duration.value,
            jarakTeks: element.distance.text,
            durasiTeks: element.duration_in_traffic?.text || element.duration.text
        };
    } catch (error) {
        console.error('[Watchdog Prediktif] ❌ Gagal menghubungi Google Maps:', error.message);
        return null;
    }
};

export const initWatchdogPrediktif = (io) => {
    // Berjalan setiap 5 menit
    cron.schedule('*/5 * * * *', async () => {
        console.log(`[Watchdog Prediktif] Memindai jadwal fisik pada: ${new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })}`);

        if (!GOOGLE_MAPS_API_KEY) {
            console.warn('[Watchdog Prediktif] ⚠️ GOOGLE_MAPS_API_KEY belum diatur. Lewati pemindaian.');
            return;
        }

        try {
            const waktuSekarang = new Date();
            const waktuBatas = new Date(waktuSekarang.getTime() + 90 * 60000); // 90 menit dari sekarang

            // Ambil jadwal statis yang butuh kehadiran fisik dan belum diperingatkan
            const jadwalFisik = await Jadwal.find({
                tipe_jadwal: 'statis',
                butuh_fisik: true,
                status_selesai: false,
                peringatan_macet_terkirim: false,
                waktu_eksekusi_statis: {
                    $gt: waktuSekarang, // Belum lewat waktunya
                    $lte: waktuBatas     // Dalam 90 menit ke depan
                }
            });

            console.log(`[Watchdog Prediktif] Menemukan ${jadwalFisik.length} jadwal fisik yang perlu dicek.`);

            if (jadwalFisik.length === 0) return;

            for (const jadwal of jadwalFisik) {
                // Tentukan tujuan: gunakan koordinat jika ada, fallback ke nama lokasi
                const tujuan = jadwal.koordinat_tujuan || jadwal.lokasi_tujuan;
                if (!tujuan) {
                    console.warn(`[Watchdog Prediktif] ⚠️ Jadwal "${jadwal.nama_kegiatan}" tidak punya lokasi/koordinat. Lewati.`);
                    continue;
                }

                console.log(`[Watchdog Prediktif] 🔍 Mengecek rute ke "${jadwal.lokasi_tujuan || tujuan}" untuk jadwal "${jadwal.nama_kegiatan}"...`);

                const hasilRute = await cekWaktuTempuh(ORIGIN_COORDS, tujuan);
                if (!hasilRute) continue; // Skip jika API gagal

                const { durasiNormalDetik, durasiMacetDetik, jarakTeks, durasiTeks } = hasilRute;
                const menitTersisa = Math.round((new Date(jadwal.waktu_eksekusi_statis).getTime() - waktuSekarang.getTime()) / 60000);
                const menitTempuhMacet = Math.ceil(durasiMacetDetik / 60);
                const rasioMacet = durasiMacetDetik / durasiNormalDetik;

                // Hitung buffer persiapan (15 menit untuk siap-siap)
                const bufferPersiapan = 15;
                const totalMenitDibutuhkan = menitTempuhMacet + bufferPersiapan;

                // Kondisi trigger: (1) Ada kemacetan signifikan, ATAU (2) Sudah waktunya berangkat
                const adaMacet = rasioMacet > 1.3;
                const sudahWaktuBerangkat = menitTersisa <= totalMenitDibutuhkan;

                if (adaMacet || sudahWaktuBerangkat) {
                    // Kunci agar tidak spam di interval berikutnya
                    await Jadwal.updateOne(
                        { _id: jadwal._id },
                        { $set: { peringatan_macet_terkirim: true, notifikasi_terkirim: true } }
                    );

                    // Susun konteks untuk Gemini
                    let konteksMacet = '';
                    if (adaMacet) {
                        konteksMacet = `PERINGATAN KEMACETAN: Rute menuju "${jadwal.lokasi_tujuan || tujuan}" sedang MACET. Waktu tempuh normal ~${Math.ceil(durasiNormalDetik / 60)} menit, tapi sekarang butuh ~${menitTempuhMacet} menit (jarak: ${jarakTeks}). `;
                    }

                    const hiddenPrompt = `Instruksi Sistem (PENTING & MENDESAK): Berperanlah sebagai asisten proaktif yang sangat peduli. ${konteksMacet}Beritahu pengguna bahwa jadwal "${jadwal.nama_kegiatan}" dijadwalkan ${menitTersisa} menit lagi di lokasi "${jadwal.lokasi_tujuan || tujuan}". Estimasi perjalanan saat ini: ${durasiTeks} (${jarakTeks}). ${adaMacet ? 'Sarankan untuk berangkat SEKARANG karena jalanan macet.' : 'Sarankan untuk mulai bersiap-siap agar tidak terlambat.'} Buat pesannya mendesak, singkat, dan natural. Jangan sebutkan bahwa kamu adalah AI atau sistem.`;

                    console.log(`[Watchdog Prediktif] 🚨 Meminta Gemini menyusun peringatan untuk "${jadwal.nama_kegiatan}"...`);
                    const result = await chatWithWaguri(hiddenPrompt, []);

                    const payload = {
                        status: "success",
                        text: result.text,
                        isProactive: true,
                        isPrediktif: true, // Penanda khusus untuk UI
                        metadata: {
                            namaKegiatan: jadwal.nama_kegiatan,
                            lokasiTujuan: jadwal.lokasi_tujuan,
                            menitTersisa,
                            menitTempuh: menitTempuhMacet,
                            jarak: jarakTeks,
                            adaMacet
                        }
                    };

                    console.log(`[Watchdog Prediktif] 📡 Menembakkan peringatan ke UI...`);
                    io.emit('chat_reply', payload);
                }
            }
        } catch (error) {
            console.error('[Watchdog Prediktif] ❌ ERROR FATAL:', error);
        }
    });

    console.log('✅ Mesin Cron "Watchdog Prediktif" telah diinisialisasi (interval: setiap 5 menit).');
};
