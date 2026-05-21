import AsetKeuangan from '../../models/AsetKeuangan.js';

export const declaration = {
    name: "perbarui_portofolio_aset",
    description: "Digunakan untuk menambah, mengubah, atau menghapus aset investasi dan catatan utang dari pangkalan data.",
    parameters: {
        type: "object",
        properties: {
            nama_aset: {
                type: "string",
                description: "Nama aset (misal: BBRI, BTC, Utang ke X).",
            },
            kategori: {
                type: "string",
                description: "Kategori aset (saham, kripto, reksadana, utang, piutang).",
                enum: ["saham", "kripto", "reksadana", "utang", "piutang"]
            },
            jumlah_unit: {
                type: "number",
                description: "Jumlah unit aset atau nominal utang/piutang.",
            },
            harga_rata_rata: {
                type: "number",
                description: "Harga rata-rata (average price) dari unit aset tersebut.",
            },
            aksi: {
                type: "string",
                description: "Aksi yang ingin dilakukan ('tambah' atau 'hapus').",
                enum: ["tambah", "hapus"]
            }
        },
        required: ["nama_aset", "kategori", "jumlah_unit", "harga_rata_rata", "aksi"],
    },
};

export async function execute(args) {
    const { nama_aset, kategori, jumlah_unit, harga_rata_rata, aksi } = args;

    try {
        if (aksi === 'hapus') {
            const deleted = await AsetKeuangan.findOneAndDelete({ nama_aset });
            if (deleted) {
                return { status: "success", message: `Aset ${nama_aset} berhasil dihapus dari portofolio.` };
            } else {
                return { status: "error", message: `Aset ${nama_aset} tidak ditemukan.` };
            }
        } else if (aksi === 'tambah') {
            const updated = await AsetKeuangan.findOneAndUpdate(
                { nama_aset },
                {
                    kategori,
                    jumlah_unit,
                    harga_rata_rata,
                    terakhir_diperbarui: new Date()
                },
                { new: true, upsert: true }
            );
            return { status: "success", message: `Aset ${nama_aset} berhasil diperbarui/ditambahkan.`, data: updated };
        } else {
            return { status: "error", message: `Aksi ${aksi} tidak dikenali.` };
        }
    } catch (error) {
        console.error("[perbarui_portofolio_aset] Error:", error);
        return {
            status: "error",
            message: "Gagal memperbarui portofolio.",
            error: error.message
        };
    }
}
