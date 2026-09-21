import { updateTargetContainer } from '../../agents/watchdog/watchdogAgent.js';
import { FAILURE_POLICIES } from '../../services/containerUpdater.js';

export const declaration = {
    name: "perbarui_kontainer_layanan",
    description: "Memerintahkan subagen The Watchdog untuk memperbarui kontainer layanan lain (seperti toko online 'revandastore-app', 'wiki-web', 'portfolio-site', atau 'wiki-game') menggunakan strategi Blue-Green Deployment dengan proteksi Auto-Repair dan Safe Rollback.",
    parameters: {
        type: "object",
        properties: {
            nama_kontainer: {
                type: "string",
                description: "Nama kontainer target yang ingin diperbarui (contoh: 'revandastore-app', 'wiki-web')."
            },
            deskripsi_tugas: {
                type: "string",
                description: "Instruksi perbaikan bug, penambahan fitur, atau pembaruan kode untuk kontainer target."
            },
            kebijakan_kegagalan: {
                type: "string",
                enum: ["AUTO_REPAIR_THEN_ROLLBACK", "ROLLBACK_ONLY"],
                description: "Strategi jika update gagal: 'AUTO_REPAIR_THEN_ROLLBACK' (coba perbaiki 1x via AI, jika tetap gagal baru rollback) atau 'ROLLBACK_ONLY' (langsung rollback darurat)."
            },
            konfirmasi_pengguna: {
                type: "boolean",
                description: "Wajib disetel 'true' hanya jika Yoga telah menyetujui pembaruan kontainer layanan ini."
            }
        },
        required: ["nama_kontainer", "deskripsi_tugas", "konfirmasi_pengguna"]
    }
};

export async function execute(args) {
    const { nama_kontainer, deskripsi_tugas, kebijakan_kegagalan, konfirmasi_pengguna } = args;

    if (!konfirmasi_pengguna) {
        return {
            status: "requires_confirmation",
            message: `Pembaruan untuk kontainer '${nama_kontainer}' ditunda. Mintalah konfirmasi eksplisit dari Yoga terlebih dahulu sebelum merestart/mengupdate kontainer layanan ini.`
        };
    }

    if (!nama_kontainer || !deskripsi_tugas) {
        return {
            status: "error",
            message: "Parameter 'nama_kontainer' dan 'deskripsi_tugas' wajib diisi."
        };
    }

    const policy = kebijakan_kegagalan === "ROLLBACK_ONLY" 
        ? FAILURE_POLICIES.ROLLBACK_ONLY 
        : FAILURE_POLICIES.AUTO_REPAIR_THEN_ROLLBACK;

    try {
        const result = await updateTargetContainer(nama_kontainer, deskripsi_tugas, policy);
        return result;
    } catch (error) {
        return {
            status: "error",
            message: `Gagal memperbarui kontainer '${nama_kontainer}': ${error.message}`
        };
    }
}
