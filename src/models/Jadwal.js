import mongoose from 'mongoose';

const jadwalSchema = new mongoose.Schema({
    id_tugas: {
        type: String,
        required: true,
        unique: true
    },
    nama_kegiatan: {
        type: String,
        required: true
    },
    tipe_jadwal: {
        type: String,
        enum: ['statis', 'kuota_fleksibel', 'absolut'],
        required: true
    },
    target_durasi_menit: {
        type: Number,
        default: 0
    },
    durasi_tercapai_menit: {
        type: Number,
        default: 0
    },
    siklus_reset: {
        type: String,
        enum: ['harian', 'mingguan', 'bulanan', 'tidak_ada'],
        default: 'mingguan'
    },
    kondisi_pemicu: {
        type: [String],
        default: []
    },
    waktu_eksekusi_statis: {
        type: Date,
        default: null
    },
    status_selesai: {
        type: Boolean,
        default: false
    },
    notifikasi_terkirim: {
        type: Boolean,
        default: false
    },
    butuh_fisik: {
        type: Boolean,
        default: false
    },
    lokasi_tujuan: {
        type: String,
        default: null
    },
    koordinat_tujuan: {
        type: String,
        default: null
    },
    peringatan_macet_terkirim: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Index untuk optimasi kueri harian
jadwalSchema.index({ waktu_eksekusi_statis: 1 });

const Jadwal = mongoose.model('Jadwal', jadwalSchema);

export default Jadwal;
