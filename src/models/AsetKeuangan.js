import mongoose from 'mongoose';

const asetKeuanganSchema = new mongoose.Schema({
    nama_aset: {
        type: String,
        required: true,
        unique: true
    },
    kategori: {
        type: String,
        enum: ["saham", "kripto", "reksadana", "utang", "piutang"],
        required: true
    },
    jumlah_unit: {
        type: Number,
        default: 0
    },
    harga_rata_rata: {
        type: Number,
        default: 0
    },
    terakhir_diperbarui: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

const AsetKeuangan = mongoose.model('AsetKeuangan', asetKeuanganSchema);

export default AsetKeuangan;
