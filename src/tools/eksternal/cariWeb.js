import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export const declaration = {
    name: "cari_web_langsung",
    description: "Melakukan pencarian resmi di internet untuk mendapatkan berita terbaru, informasi kurs, atau fakta real-time yang tidak diketahui AI.",
    parameters: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "Kata kunci pencarian spesifik (contoh: nilai tukar rupiah hari ini, beasiswa kedokteran unri 2026)"
            }
        },
        required: ["query"]
    }
};

export async function execute(args) {
    const query = args.query;
    
    if (!query) {
        return { status: "error", message: "Parameter 'query' wajib diisi." };
    }

    // Proteksi: Pastikan Key Google tersedia di VPS
    if (!process.env.GOOGLE_SEARCH_KEY || !process.env.GOOGLE_CX) {
        return { status: "error", message: "API Key Google Custom Search belum dikonfigurasi di file .env server." };
    }

    try {
        const googleUrl = `https://www.googleapis.com/customsearch/v1`;
        const params = {
            key: process.env.GOOGLE_SEARCH_KEY,
            cx: process.env.GOOGLE_CX,
            q: query,
            num: 5, // Batasi 5 hasil saja untuk menghemat token konteks
            gl: 'id',
            hl: 'id'
        };

        const response = await axios.get(googleUrl, { params });
        const items = response.data.items;

        if (!items || items.length === 0) {
            return { status: "success", message: `Google tidak menemukan hasil yang relevan untuk query: ${query}` };
        }

        // Memeras data mentah Google menjadi format objek super hemat token
        const hasilDisaring = items.map((item, index) => ({
            indeks: index + 1,
            judul: item.title,
            tautan: item.link,
            cuplikan: item.snippet
        }));

        return { 
            status: "success", 
            hasil_pencarian: hasilDisaring 
        };

    } catch (error) {
        if (error.response && error.response.status === 429) {
            return { status: "error", message: "Kuota harian Google Custom Search API di server telah habis." };
        }
        return { status: "error", message: `Gagal mengakses Google API: ${error.message}` };
    }
}