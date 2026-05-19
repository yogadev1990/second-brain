import Jadwal from '../../models/Jadwal.js';

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
            waktu_eksekusi_statis
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

        const jadwalBaru = new Jadwal(jadwalData);
        await jadwalBaru.save();

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
