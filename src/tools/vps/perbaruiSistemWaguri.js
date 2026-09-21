import { containerUpdater, FAILURE_POLICIES } from '../../services/containerUpdater.js';

export const declaration = {
    name: "perbarui_sistem_waguri",
    description: "Mengaktifkan kemampuan self-evolution Waguri untuk memperbarui dirinya sendiri (menambahkan tool baru, mengedit logika, atau mengupgrade dependensi) menggunakan pola Blue-Green Rolling Replacement dengan proteksi Auto-Repair dan Git Rollback.",
    parameters: {
        type: "object",
        properties: {
            deskripsi_tugas: {
                type: "string",
                description: "Rincian fitur baru, perbaikan bug, atau tugas pembaruan yang harus diterapkan pada kode sumber Waguri."
            },
            konfirmasi_pengguna: {
                type: "boolean",
                description: "Wajib disetel 'true' hanya jika pengguna (Yoga) sudah secara eksplisit menyetujui pembaruan sistem."
            }
        },
        required: ["deskripsi_tugas", "konfirmasi_pengguna"]
    }
};

export async function execute(args) {
    const { deskripsi_tugas, konfirmasi_pengguna } = args;

    if (!konfirmasi_pengguna) {
        return {
            status: "requires_confirmation",
            message: "Pembaruan sistem ditunda. Anda harus meminta konfirmasi eksplisit dari Yoga terlebih dahulu sebelum memodifikasi kernel Waguri."
        };
    }

    if (!deskripsi_tugas) {
        return {
            status: "error",
            message: "Parameter 'deskripsi_tugas' wajib diisi."
        };
    }

    try {
        const result = await containerUpdater.updateContainer({
            containerName: process.env.CONTAINER_NAME || 'secondbrain',
            taskDescription: deskripsi_tugas,
            failurePolicy: FAILURE_POLICIES.AUTO_REPAIR_THEN_ROLLBACK
        });
        return result;
    } catch (error) {
        return {
            status: "error",
            message: `Gagal menjalankan pembaruan diri: ${error.message}`
        };
    }
}

