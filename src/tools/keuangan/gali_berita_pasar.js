import Parser from 'rss-parser';

export const declaration = {
    name: "gali_berita_pasar",
    description: "Digunakan untuk mengambil berita keuangan atau sentimen pasar terkini berdasarkan kata kunci tertentu.",
    parameters: {
        type: "object",
        properties: {
            kata_kunci: {
                type: "string",
                description: "Kata kunci untuk pencarian berita (misal: 'saham perbankan', 'kondisi kripto').",
            },
        },
        required: ["kata_kunci"],
    },
};

export async function execute(args) {
    const { kata_kunci } = args;

    try {
        const parser = new Parser();
        const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(kata_kunci + ' keuangan OR ekonomi OR saham OR kripto')}&hl=id&gl=ID&ceid=ID:id`;
        
        const feed = await parser.parseURL(feedUrl);
        
        if (!feed.items || feed.items.length === 0) {
            return { status: "success", hasil: `Tidak ada berita terbaru ditemukan untuk kata kunci: ${kata_kunci}` };
        }

        let combinedNews = `Berita pasar terkini untuk "${kata_kunci}":\n`;
        // Ambil maksimal 3 berita utama
        const topItems = feed.items.slice(0, 3);
        
        topItems.forEach((item, index) => {
            combinedNews += `${index + 1}. ${item.title}\nSumber: ${item.source || item.creator}\nTanggal: ${item.pubDate}\n\n`;
        });

        return { status: "success", hasil: combinedNews };
    } catch (error) {
        console.error("[gali_berita_pasar] Error:", error);
        return {
            status: "error",
            message: "Gagal mengambil berita pasar.",
            error: error.message
        };
    }
}
