import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Direktori penyimpanan media publik yang disajikan statis oleh Express
const MEDIA_DIR = path.join(process.cwd(), 'public', 'media');

if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

export const declaration = {
    name: "kirim_gambar",
    description: "Membuat gambar baru menggunakan AI (Imagen/Pollinations) atau melampirkan gambar/grafik/foto dari URL atau file lokal untuk dikirimkan langsung ke Mas Yoga di ruang obrolan chat.",
    parameters: {
        type: "object",
        properties: {
            tipe: {
                type: "string",
                enum: ["generate_ai", "dari_url", "dari_file_lokal"],
                description: "Metode: 'generate_ai' untuk melukis/membuat gambar baru dari prompt, 'dari_url' untuk mengambil gambar dari web, atau 'dari_file_lokal' untuk melampirkan gambar/grafik lokal dari server/sandbox."
            },
            prompt_atau_deskripsi: {
                type: "string",
                description: "Deskripsi detail tentang gambar yang ingin dibuat (dalam bahasa Inggris atau Indonesia) jika tipe='generate_ai'."
            },
            url_sumber: {
                type: "string",
                description: "URL gambar publik di internet (wajib jika tipe='dari_url')."
            },
            path_file_lokal: {
                type: "string",
                description: "Path file gambar di server (wajib jika tipe='dari_file_lokal')."
            },
            caption: {
                type: "string",
                description: "Keterangan manis atau penjelasan singkat mengenai gambar untuk Mas Yoga."
            }
        },
        required: ["tipe"]
    }
};

/**
 * Helper untuk menyusun URL media
 */
function buildMediaUrls(fileName, caption) {
    const relativePath = `/media/${fileName}`;
    const baseUrl = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, '') : '';
    const fullUrl = baseUrl ? `${baseUrl}${relativePath}` : relativePath;

    return {
        type: 'image',
        url: fullUrl,
        relativePath,
        caption: caption || ''
    };
}

export async function execute(args) {
    const { tipe, prompt_atau_deskripsi, url_sumber, path_file_lokal, caption } = args || {};

    if (!tipe) {
        return { status: "error", message: "Parameter 'tipe' wajib diisi." };
    }

    try {
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 8);

        // 1. GENERATE DENGAN AI (Pollinations / Flux Engine)
        if (tipe === 'generate_ai') {
            if (!prompt_atau_deskripsi) {
                return { status: "error", message: "Parameter 'prompt_atau_deskripsi' wajib disertakan saat generate_ai." };
            }

            console.log(`[KirimGambar] Menghasilkan gambar AI dengan prompt: "${prompt_atau_deskripsi}"...`);
            const encodedPrompt = encodeURIComponent(prompt_atau_deskripsi);
            const seed = Math.floor(Math.random() * 1000000);
            const genUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${seed}`;

            const response = await axios.get(genUrl, {
                responseType: 'arraybuffer',
                timeout: 45000 // 45 detik batas waktu pembuatan gambar
            });

            const fileName = `ai_${timestamp}_${randomId}.jpg`;
            const filePath = path.join(MEDIA_DIR, fileName);
            fs.writeFileSync(filePath, Buffer.from(response.data));

            console.log(`[KirimGambar] Gambar AI berhasil disimpan di ${filePath}`);
            const media = buildMediaUrls(fileName, caption || prompt_atau_deskripsi);

            return {
                status: "success",
                media,
                message: `Gambar berhasil dibuat dan dilampirkan ke obrolan: ${media.url}`
            };
        }

        // 2. DARI URL WEB EKSTERNAL
        if (tipe === 'dari_url') {
            if (!url_sumber) {
                return { status: "error", message: "Parameter 'url_sumber' wajib disertakan saat tipe='dari_url'." };
            }

            console.log(`[KirimGambar] Mengunduh gambar dari URL: ${url_sumber}...`);
            const response = await axios.get(url_sumber, {
                responseType: 'arraybuffer',
                timeout: 30000
            });

            const contentType = response.headers['content-type'] || 'image/jpeg';
            let ext = '.jpg';
            if (contentType.includes('png')) ext = '.png';
            else if (contentType.includes('webp')) ext = '.webp';
            else if (contentType.includes('gif')) ext = '.gif';

            const fileName = `web_${timestamp}_${randomId}${ext}`;
            const filePath = path.join(MEDIA_DIR, fileName);
            fs.writeFileSync(filePath, Buffer.from(response.data));

            const media = buildMediaUrls(fileName, caption);

            return {
                status: "success",
                media,
                message: `Gambar dari URL berhasil disimpan dan dilampirkan: ${media.url}`
            };
        }

        // 3. DARI FILE LOKAL (GRAFIK/SANDBOX/WORKSPACE)
        if (tipe === 'dari_file_lokal') {
            if (!path_file_lokal) {
                return { status: "error", message: "Parameter 'path_file_lokal' wajib disertakan saat tipe='dari_file_lokal'." };
            }

            const sourcePath = path.resolve(path_file_lokal);
            if (!fs.existsSync(sourcePath)) {
                return { status: "error", message: `File lokal tidak ditemukan pada path: ${path_file_lokal}` };
            }

            const ext = path.extname(sourcePath) || '.png';
            const fileName = `local_${timestamp}_${randomId}${ext}`;
            const destinationPath = path.join(MEDIA_DIR, fileName);

            fs.copyFileSync(sourcePath, destinationPath);
            const media = buildMediaUrls(fileName, caption);

            return {
                status: "success",
                media,
                message: `File gambar lokal berhasil dilampirkan: ${media.url}`
            };
        }

        return { status: "error", message: `Tipe '${tipe}' tidak dikenali. Gunakan 'generate_ai', 'dari_url', atau 'dari_file_lokal'.` };

    } catch (err) {
        console.error('[KirimGambar] Gagal memproses gambar:', err.message);
        return {
            status: "error",
            message: `Gagal memproses gambar: ${err.message}`
        };
    }
}
