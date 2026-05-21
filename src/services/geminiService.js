import { GoogleGenerativeAI } from "@google/generative-ai";
import { toolDeclarations, toolHandlers } from "../tools/index.js";
import dotenv from "dotenv";

dotenv.config();

// Inisialisasi Gemini Client
// Menggunakan API Key dari environment variable
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function chatWithWaguri(prompt, chatHistory = []) {
    // Cek apakah API Key sudah dikonfigurasi
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY belum dikonfigurasi di file .env");
    }

    // Dapatkan waktu saat ini secara dinamis dengan zona waktu WIB (Asia/Jakarta)
    const waktuSekarang = new Date().toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        dateStyle: "full",
        timeStyle: "long"
    });

    // Konfigurasi model dan daftarkan tools jika ada
    const modelConfig = {
        model: "gemini-2.5-flash",
        systemInstruction: `Kamu adalah Waguri. Kamu memiliki memori jangka pendek terbatas. Jika pengguna menanyakan informasi masa lalu, janji lama, atau data pribadi yang tidak ada di riwayat obrolan ini, kamu DILARANG menjawab tidak tahu. Kamu WAJIB memanggil alat gali_ingatan (RAG) untuk mencari fakta tersebut di pangkalan data sebelum menjawab.\n\nWaktu server saat ini adalah: ${waktuSekarang}. Lokasi fisik pengguna saat ini berada di Palembang. Status pengguna: Randa, seorang INTP, Mahasiswa Kedokteran Gigi yang saat ini sedang dalam masa libur perkuliahan. Gunakan informasi waktu ini sebagai patokan absolut jika pengguna menyebutkan kata seperti 'besok', 'lusa', atau 'nanti malam'.`
    };
    
    if (toolDeclarations.length > 0) {
        modelConfig.tools = [{
            functionDeclarations: toolDeclarations
        }];
        console.log(`[Gemini] Model diinisialisasi dengan ${toolDeclarations.length} alat/tools.`);
    }

    const model = genAI.getGenerativeModel(modelConfig);

    const chat = model.startChat({
        history: chatHistory,
    });

    // Akumulator token untuk seluruh siklus percakapan (termasuk function call rounds)
    const tokenUsage = {
        promptTokens: 0,
        candidatesTokens: 0,
        totalTokens: 0,
        roundDetails: []
    };

    // Helper: catat token dari setiap respons Gemini
    function trackTokens(response, label) {
        const meta = response.usageMetadata;
        if (meta) {
            const prompt = meta.promptTokenCount || 0;
            const candidates = meta.candidatesTokenCount || 0;
            const total = meta.totalTokenCount || 0;

            tokenUsage.promptTokens += prompt;
            tokenUsage.candidatesTokens += candidates;
            tokenUsage.totalTokens += total;
            tokenUsage.roundDetails.push({ label, prompt, candidates, total });

            console.log(`[Token] ${label} — Prompt: ${prompt} | Candidates: ${candidates} | Total: ${total}`);
        }
    }

    try {
        let result = await chat.sendMessage(prompt);
        let response = result.response;
        trackTokens(response, "Pesan awal");

        // Loop untuk menangani function calls secara sekuensial (misalnya jika Gemini memanggil tool berkali-kali)
        let rounds = 0;
        const MAX_ROUNDS = 5;

        while (typeof response.functionCalls === 'function' && response.functionCalls() && response.functionCalls().length > 0 && rounds < MAX_ROUNDS) {
            rounds++;
            const calls = response.functionCalls();
            const functionResponses = [];

            for (const call of calls) {
                // Function Call Router: Mencocokkan nama tool dengan fungsinya di registri
                const handler = toolHandlers[call.name];
                
                if (handler) {
                    console.log(`[Function Call] Mengeksekusi: ${call.name} dengan args:`, call.args);
                    try {
                        const toolResult = await handler(call.args);
                        functionResponses.push({
                            functionResponse: {
                                name: call.name,
                                response: toolResult
                            }
                        });
                    } catch (err) {
                        console.error(`[Error] Eksekusi alat ${call.name} gagal:`, err);
                        functionResponses.push({
                            functionResponse: {
                                name: call.name,
                                response: { error: err.message }
                            }
                        });
                    }
                } else {
                    console.warn(`[Warning] Alat dengan nama ${call.name} tidak ditemukan di registri.`);
                    functionResponses.push({
                        functionResponse: {
                            name: call.name,
                            response: { error: "Alat tidak terdaftar pada backend" }
                        }
                    });
                }
            }

            // Kirim balik hasil dari functions ke Gemini
            console.log(`[Gemini] Mengirim hasil alat kembali ke model... (Ronde ${rounds})`);
            result = await chat.sendMessage(functionResponses);
            response = result.response;
            trackTokens(response, `Function Call Ronde ${rounds}`);
        }

        if (rounds >= MAX_ROUNDS) {
            console.warn("[Warning] Mencapai batas maksimal iterasi pemanggilan alat (MAX_ROUNDS).");
        }

        console.log(`[Token] === TOTAL AKUMULASI === Prompt: ${tokenUsage.promptTokens} | Candidates: ${tokenUsage.candidatesTokens} | Grand Total: ${tokenUsage.totalTokens}`);

        return {
            text: response.text(),
            tokenUsage,
            history: await chat.getHistory()
        };
    } catch (error) {
        console.error("Error pada chatWithWaguri:", error);
        throw error;
    }
}
