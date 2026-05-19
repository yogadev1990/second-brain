import Jadwal from '../../models/Jadwal.js';
import { google } from 'googleapis';
import { oauth2Client } from '../../services/googleAuth.js';

export const declaration = {
    name: "tambah_jadwal",
    description: "Gunakan alat ini SECARA EKSKLUSIF untuk mencatat rutinitas harian (seperti cuci muka), target kuota waktu (seperti gym/belajar), dan jadwal/janji temu. Jika pengguna meminta untuk diingatkan melakukan sesuatu secara berulang atau pada waktu tertentu, WAJIB panggil alat ini agar data masuk ke database kalender.",
    parameters: {
        type: "OBJECT",
        properties: {
            id_tugas: {
                type: "STRING",
                description: "ID unik untuk tugas ini (misal: jadwal_belajar_1)."
            },
            nama_kegiatan: {
                type: "STRING",
                description: "Nama atau deskripsi kegiatan."
            },
            tipe_jadwal: {
                type: "STRING",
                description: "Tipe jadwal, harus salah satu dari: 'statis' atau 'kuota_fleksibel'."
            },
            target_durasi_menit: {
                type: "NUMBER",
                description: "Target durasi dalam menit. Gunakan 0 jika tidak ada target."
            },
            siklus_reset: {
                type: "STRING",
                description: "Siklus perulangan/reset jadwal, pilih antara: 'harian', 'mingguan', 'bulanan', atau 'tidak_ada'."
            },
            kondisi_pemicu: {
                type: "ARRAY",
                items: {
                    type: "STRING"
                },
                description: "Kondisi atau pemicu agar jadwal ini dieksekusi (contoh: ['setelah_makan', 'jam_18:00'])."
            },
            waktu_eksekusi_statis: {
                type: "STRING",
                description: "Waktu eksekusi untuk jadwal statis dalam format ISO-8601. DILARANG KERAS menggunakan huruf 'Z' di akhir waktu. WAJIB menggunakan offset zona waktu WIB yaitu +07:00. Contoh format yang benar: '2026-05-19T23:38:00+07:00'."
            },
            butuh_fisik: {
                type: "BOOLEAN",
                description: "Set 'true' jika jadwal ini mengharuskan pengguna bepergian/pergi ke lokasi tertentu (contoh: meeting di kantor, nongkrong di kafe, kelas di kampus). Set 'false' atau kosongkan jika jadwal hanya berupa alarm/pengingat diam di rumah tanpa perlu mobilitas (contoh: minum obat, cuci muka, sholat)."
            },
            lokasi_tujuan: {
                type: "STRING",
                description: "Nama atau alamat lokasi tujuan jika butuh_fisik=true (contoh: 'Kantor Pusat Jl. Sudirman No.1', 'Kampus UI Depok'). Kosongkan jika butuh_fisik=false."
            },
            koordinat_tujuan: {
                type: "STRING",
                description: "Koordinat GPS lokasi tujuan dalam format 'latitude,longitude' (contoh: '-6.2088,106.8456'). Kosongkan jika tidak diketahui atau butuh_fisik=false."
            }
        },
        required: ["id_tugas", "nama_kegiatan", "tipe_jadwal"]
    }
};

export const execute = async (args) => {
    try {
        const {
            id_tugas,
            nama_kegiatan,
            tipe_jadwal,
            target_durasi_menit,
            siklus_reset,
            kondisi_pemicu,
            waktu_eksekusi_statis,
            butuh_fisik,
            lokasi_tujuan,
            koordinat_tujuan
        } = args;

        const jadwalData = {
            id_tugas,
            nama_kegiatan,
            tipe_jadwal
        };

        if (target_durasi_menit !== undefined) jadwalData.target_durasi_menit = target_durasi_menit;
        if (siklus_reset !== undefined) jadwalData.siklus_reset = siklus_reset;
        if (kondisi_pemicu !== undefined) jadwalData.kondisi_pemicu = kondisi_pemicu;
        if (waktu_eksekusi_statis) jadwalData.waktu_eksekusi_statis = new Date(waktu_eksekusi_statis);
        if (butuh_fisik !== undefined) jadwalData.butuh_fisik = butuh_fisik;
        if (lokasi_tujuan) jadwalData.lokasi_tujuan = lokasi_tujuan;
        if (koordinat_tujuan) jadwalData.koordinat_tujuan = koordinat_tujuan;

        const jadwalBaru = new Jadwal(jadwalData);
        await jadwalBaru.save();

        // Jika ini adalah jadwal statis, suntikkan juga ke Google Calendar
        if (tipe_jadwal === 'statis' && waktu_eksekusi_statis) {
            try {
                const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

                // Buat estimasi waktu selesai (default: 1 jam dari waktu mulai)
                const waktuMulai = new Date(waktu_eksekusi_statis);
                const waktuSelesai = new Date(waktuMulai.getTime() + 60 * 60000);

                await calendar.events.insert({
                    calendarId: 'primary',
                    requestBody: {
                        summary: nama_kegiatan,
                        description: 'Dibuat secara otomatis oleh Waguri AI (Jadwal Statis)',
                        start: {
                            dateTime: waktuMulai.toISOString(),
                            timeZone: 'Asia/Jakarta',
                        },
                        end: {
                            dateTime: waktuSelesai.toISOString(),
                            timeZone: 'Asia/Jakarta',
                        },
                        reminders: {
                            useDefault: false,
                            overrides: [
                                { method: 'popup', minutes: 15 },
                            ],
                        },
                    },
                });
                console.log(`✅ [Google Calendar] Acara '${nama_kegiatan}' berhasil diinjeksi.`);
            } catch (err) {
                console.error('❌ [Google Calendar] Gagal menyuntikkan jadwal:', err.message);
                // Kita tidak men-throw error agar jika Google gagal, jadwal di MongoDB tetap aman
            }
        }

        return {
            status: "success",
            message: `Jadwal '${nama_kegiatan}' berhasil dicatat dengan ID ${id_tugas}.`
        };
    } catch (error) {
        console.error("Error pada executeTambahJadwal:", error);
        return {
            status: "error",
            message: "Gagal menyimpan jadwal ke database.",
            error: error.message
        };
    }
};
