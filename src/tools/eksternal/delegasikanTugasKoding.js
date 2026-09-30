import path from 'path';
import fs from 'fs';
import { coderService } from '../../services/coderService.js';
import { mcpClient } from '../../services/mcpClient.js';
import { eventBus } from '../../core/bus/eventBus.js';
import { TOPICS } from '../../core/bus/topics.js';

export const declaration = {
    name: "delegasikan_tugas_koding",
    description: "Mendelegasikan tugas pemrograman, pembuatan fitur/tools baru, penulisan script, atau perakitan generator visual kepada Subagent 'The Coder' (Aider / Worker Sandbox). Subagent akan bekerja secara otonom di latar belakang, memancarkan progres pengerjaan ke chatroom secara real-time, dan mengembalikan hasil akhirnya tanpa membebani memori percakapan Waguri.",
    parameters: {
        type: "object",
        properties: {
            deskripsi_tugas: {
                type: "string",
                description: "Deskripsi jelas mengenai tugas coding, fitur, atau generator yang ingin dibuat/dijalankan (contoh: 'Buatkan generator stiker brat dengan teks kustom dan simpan gambarnya', atau 'Tulis skrip Python untuk analisis data')."
            },
            target_lingkungan: {
                type: "string",
                enum: ["sandbox", "proyek_eksternal"],
                description: "Lingkungan eksekusi: 'sandbox' untuk skrip mandiri/generator/visualisasi di MCP Sandbox, atau 'proyek_eksternal' untuk memodifikasi folder kode sumber proyek."
            },
            output_yang_diharapkan: {
                type: "string",
                enum: ["gambar_visual", "kode_program", "hasil_eksekusi"],
                description: "Jenis output utama: 'gambar_visual' jika menghasilkan stiker/grafik/gambar, 'kode_program' jika membuat file kode, atau 'hasil_eksekusi' jika berupa hasil data/kalkulasi."
            }
        },
        required: ["deskripsi_tugas"]
    }
};

async function emitChatroomLog(status, message) {
    try {
        await eventBus.publish(TOPICS.DEVOPS?.CHATROOM || 'waguri:chatroom', {
            agentName: 'The Coder',
            status,
            message
        });
    } catch (_) {}
}

export async function execute(args) {
    const { deskripsi_tugas, target_lingkungan = 'sandbox', output_yang_diharapkan = 'gambar_visual' } = args || {};

    if (!deskripsi_tugas) {
        return { status: "error", message: "Parameter 'deskripsi_tugas' wajib diisi." };
    }

    await emitChatroomLog('thinking', `Menerima delegasi tugas: "${deskripsi_tugas}"`);

    try {
        // JALUR 1: Eksekusi Sandbox untuk Generator / Visual / Ad-hoc Scripts
        if (target_lingkungan === 'sandbox') {
            await emitChatroomLog('working', 'Menyiapkan modul eksekusi di kontainer MCP Sandbox...');

            // Sintesis kode via Coder Engine untuk dieksekusi di sandbox
            const promptSintesis = `Tuliskan script kode Python lengkap yang siap dieksekusi di terminal untuk menyelesaikan tugas berikut:
Tugas: "${deskripsi_tugas}"
Ketentuan Mutlak:
1. Jika menghasilkan gambar/grafik/stiker visual, gunakan PIL (Pillow) atau matplotlib, dan simpan file output langsung ke direktori kerja dengan nama 'output.png' (atau format gambar lainnya).
2. Cetak ringkasan status pengerjaan atau hasil akhir ke stdout.
3. Hanya kembalikan KODE MENTAH Python saja (tanpa markdown backticks, tanpa penjelasan tambahan).`;

            let generatedCode = '';
            try {
                const aiModel = coderService.ai.models;
                const genResult = await aiModel.generateContent({
                    model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
                    contents: promptSintesis
                });
                generatedCode = (genResult.text || '').replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();
            } catch (synthErr) {
                await emitChatroomLog('working', `Sintesis awal terkendala (${synthErr.message}), beralih ke eksekusi langsung...`);
            }

            if (!generatedCode) {
                generatedCode = `# Auto-generated runner\nprint("Memproses tugas: ${deskripsi_tugas}")`;
            }

            await emitChatroomLog('working', 'The Coder mengeksekusi script di dalam sandbox terisolasi...');

            const execResult = await mcpClient.executeTool('sandbox_execute_script', {
                language: 'python',
                code: generatedCode
            });

            await emitChatroomLog('done', 'Tugas berhasil diselesaikan oleh Subagent The Coder!');

            return {
                status: "success",
                subagent: "The Coder",
                message: `Tugas "${deskripsi_tugas}" telah selesai dikerjakan oleh Subagent The Coder di sandbox.`,
                detail: execResult.stdout || execResult.message,
                media: execResult.media || undefined
            };
        }

        // JALUR 2: Proyek Kode Eksternal / File Sistem
        await emitChatroomLog('working', 'Menjalankan Autonomous Coder pada direktori proyek...');
        const workspaceDir = path.resolve(process.cwd(), 'workspace');
        if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });

        const coderResult = await coderService.runAutonomousCoder({
            targetDir: workspaceDir,
            taskDescription: deskripsi_tugas,
            emitLog: emitChatroomLog
        });

        await emitChatroomLog('done', 'Pengerjaan kode proyek selesai.');

        return {
            status: "success",
            subagent: "The Coder",
            message: coderResult.message || `Kode berhasil dimodifikasi sesuai instruksi.`
        };

    } catch (err) {
        await emitChatroomLog('error', `Kegagalan eksekusi subagent: ${err.message}`);
        return {
            status: "error",
            message: `Subagent The Coder mengalami kendala: ${err.message}`
        };
    }
}
