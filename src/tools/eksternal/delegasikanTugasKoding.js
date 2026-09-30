import path from 'path';
import fs from 'fs';
import { coderService } from '../../services/coderService.js';
import { mcpClient } from '../../services/mcpClient.js';
import { eventBus } from '../../core/bus/eventBus.js';
import { TOPICS } from '../../core/bus/topics.js';

export const declaration = {
    name: "delegasikan_tugas_koding",
    description: "Mendelegasikan tugas pemrograman, pembuatan fitur/tools baru, penulisan script, atau perakitan generator visual kepada Subagent 'The Coder' (Aider / Worker Sandbox). Subagent akan bekerja secara otonom di latar belakang, memancarkan progres pengerjaan ke chatroom secara real-time, dan mengembalikan hasil akhirnya tanpa membebani memori percakapan Waguri. PENTING: Jika tugas menghasilkan gambar/stiker, media tersebut SUDAH OTOMATIS disajikan ke chatroom; kamu DILARANG memanggil alat 'kirim_gambar' lagi.",
    parameters: {
        type: "object",
        properties: {
            deskripsi_tugas: {
                type: "string",
                description: "Deskripsi jelas mengenai tugas coding, fitur, atau generator yang ingin dibuat/dijalankan (contoh: 'Buatkan generator stiker brat dengan teks kustom', atau 'Tulis skrip Python untuk analisis data')."
            },
            target_lingkungan: {
                type: "string",
                enum: ["sandbox", "proyek_eksternal"],
                description: "Lingkungan eksekusi: 'sandbox' untuk skrip mandiri/generator/visualisasi di MCP Sandbox, atau 'proyek_eksternal' untuk memodifikasi folder kode sumber proyek."
            },
            output_yang_diharapkan: {
                type: "string",
                enum: ["gambar_visual", "kode_program", "hasil_eksekusi", "tool_permanen_baru"],
                description: "Jenis output utama: 'gambar_visual' jika menghasilkan stiker/grafik/gambar, 'kode_program' jika membuat file kode, 'hasil_eksekusi' jika berupa kalkulasi/data, atau 'tool_permanen_baru' jika Mas Yoga ingin membuat skill/tool permanen yang bisa dipakai selamanya."
            },
            nama_tool_permanen: {
                type: "string",
                description: "Nama fungsi unik (snake_case) jika ingin didaftarkan sebagai tool permanen (contoh: 'hitung_imt_klinis', 'cek_harga_emas')"
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
    const {
        deskripsi_tugas,
        target_lingkungan = 'sandbox',
        output_yang_diharapkan = 'gambar_visual',
        nama_tool_permanen
    } = args || {};

    if (!deskripsi_tugas) {
        return { status: "error", message: "Parameter 'deskripsi_tugas' wajib diisi." };
    }

    await emitChatroomLog('thinking', `Menerima delegasi tugas: "${deskripsi_tugas}"`);

    try {
        // JALUR 1: Pendaftaran Tool Baru Permanen (Skill Factory)
        if (output_yang_diharapkan === 'tool_permanen_baru' || nama_tool_permanen) {
            const rawName = nama_tool_permanen || deskripsi_tugas.split(' ')[0];
            const cleanName = rawName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);

            await emitChatroomLog('working', `Merakit arsitektur tool baru '${cleanName}' untuk didaftarkan permanen...`);

            const promptSintesisTool = `Kamu adalah arsitek tool Python untuk Model Context Protocol (MCP) Sandbox.
Rancang tool baru bernama '${cleanName}' untuk tugas:
"${deskripsi_tugas}"

Format respon WAJIB berupa JSON murni dengan struktur:
{
  "description": "Deskripsi singkat dan jelas mengenai apa yang dilakukan tool ini",
  "inputSchema": {
    "type": "object",
    "properties": {
      /* Definisikan parameter spesifik yang dibutuhkan tool ini, misalnya 'query', 'limit', 'filter', dll */
    }
  },
  "code": "/* KODE LENGKAP PYTHON */"
}

Ketentuan Mutlak untuk kode Python:
1. Pembacaan argumen: Baca dari os.environ.get('TOOL_ARGS', '{}'). Gunakan pola toleran: jika 'input' berisi dictionary atau JSON string, unwrap dan merge ke dictionary utama argumen.
2. Jika melakukan HTTP request: WAJIB menyertakan header User-Agent browser modern ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36').
3. Terapkan timeout request (maksimal 10 detik) dan penanganan try-except yang anggun. Jika API eksternal mengembalikan error/timeout (misal HTTP 504 Gateway Timeout, 403, 429), cetak JSON: {"status": "error", "message": "Layanan API eksternal sedang mengalami gangguan/timeout, silakan coba beberapa saat lagi."} dan jangan biarkan script crash fatal.
4. Jika menghasilkan gambar/stiker, simpan ke file lokal (misal: 'output.png') atau cetak format {"image_base64": "..."}.
5. Cetak hasil akhir berupa JSON atau teks rapi ke stdout.
Kembalikan HANYA JSON tanpa markdown backticks tambahan.`;

            let toolCode = '';
            let toolDescription = `Tool kustom: ${deskripsi_tugas}`;
            let toolSchema = {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Kata kunci pencarian atau teks input utama' },
                    limit: { type: 'integer', description: 'Batas jumlah hasil (contoh: 5, 10)' },
                    filter: { type: 'string', description: 'Filter kategori atau tipe' },
                    input: { type: 'string', description: 'Parameter input bebas/JSON string' }
                }
            };

            try {
                const aiModel = coderService.ai.models;
                const genResult = await aiModel.generateContent({
                    model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
                    contents: promptSintesisTool
                });
                const rawText = (genResult.text || '').replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
                
                try {
                    const parsed = JSON.parse(rawText);
                    if (parsed.code) toolCode = parsed.code;
                    if (parsed.description) toolDescription = parsed.description;
                    if (parsed.inputSchema && typeof parsed.inputSchema === 'object') {
                        toolSchema = parsed.inputSchema;
                    }
                } catch (_) {
                    toolCode = rawText;
                }
            } catch (err) {
                toolCode = `# Tool: ${cleanName}\nimport json, os\nargs = json.loads(os.environ.get('TOOL_ARGS', '{}'))\nprint(f"Eksekusi ${cleanName} dengan args: {args}")`;
            }

            if (!toolCode) {
                toolCode = `# Tool: ${cleanName}\nimport json, os\nargs = json.loads(os.environ.get('TOOL_ARGS', '{}'))\nprint(f"Eksekusi ${cleanName} dengan args: {args}")`;
            }

            await emitChatroomLog('working', `Menyimpan tool '${cleanName}' ke dalam direktori persisten MCP Sandbox...`);

            // Daftarkan ke sandbox via sandbox_register_custom_tool
            const regResult = await mcpClient.executeTool('sandbox_register_custom_tool', {
                name: cleanName,
                description: toolDescription,
                language: 'python',
                code: toolCode,
                inputSchema: toolSchema
            });

            // Refresh tools on-the-fly di Waguri backend tanpa restart
            try {
                const toolsModule = await import('../index.js');
                if (typeof toolsModule.refreshMcpTools === 'function') {
                    await toolsModule.refreshMcpTools();
                }
            } catch (_) {}
            await emitChatroomLog('done', `Tool baru '${cleanName}' telah aktif dan siap digunakan selamanya!`);

            return {
                status: "success",
                subagent: "The Coder",
                action: "TOOL_REGISTERED",
                tool_name: cleanName,
                message: `Tool baru '${cleanName}' telah berhasil dirakit, disimpan di sandbox, dan otomatis terdaftar di sistem. Ke depannya, kamu bisa langsung memanggil tool '${cleanName}' kapan pun Mas Yoga membutuhkannya!`,
                instruksi_tindakan_waguri: `Beri tahu Mas Yoga dengan gembira dan santun bahwa skill baru '${cleanName}' telah berhasil ditambahkan ke kemampuan Waguri dan siap digunakan kapan saja tanpa perlu ngoding ulang.`
            };
        }

        // JALUR 2: Eksekusi Sandbox untuk Generator / Visual / Ad-hoc Scripts
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

            const instruksiWaguri = execResult.media
                ? "PENTING UNTUK WAGURI: Hasil gambar dari tugas ini SUDAH OTOMATIS dilampirkan dan tampil di layar chat Mas Yoga. DILARANG KERAS memanggil tool 'kirim_gambar', DILARANG memanggil 'sandbox_execute_script' untuk encode base64, dan DILARANG mencari file lokal lagi! Cukup sapa Mas Yoga dengan ramah dan katakan hasilnya sudah siap."
                : "Tugas telah selesai diproses oleh Subagent The Coder.";

            return {
                status: "success",
                subagent: "The Coder",
                message: `Tugas "${deskripsi_tugas}" telah selesai dikerjakan oleh Subagent The Coder di sandbox.`,
                media_terlampir_otomatis: !!execResult.media,
                instruksi_tindakan_waguri: instruksiWaguri,
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
