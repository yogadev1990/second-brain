import { GoogleGenAI } from "@google/genai";
import { toolDeclarations, toolHandlers } from "../tools/index.js";
import dotenv from "dotenv";

dotenv.config();

// Inisialisasi Gemini Client menggunakan SDK @google/genai
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

import { sanitizeGeminiHistory } from "../utils/geminiSanitizer.js";

export { sanitizeGeminiHistory };

export async function chatWithWaguri(prompt, chatHistory = []) {
    // Cek apakah API Key sudah dikonfigurasi
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY belum dikonfigurasi di file .env");
    }

    // Sanitasi chatHistory & prompt agar valid dan mematuhi skema Gemini
    const pojoHistory = Array.isArray(chatHistory)
        ? JSON.parse(JSON.stringify(chatHistory))
        : [];
    const cleanHistory = sanitizeGeminiHistory(pojoHistory);
    const cleanPrompt = typeof prompt === 'string'
        ? prompt
        : JSON.parse(JSON.stringify(prompt));

    // Dapatkan waktu saat ini secara dinamis dengan zona waktu WIB (Asia/Jakarta)
    const waktuSekarang = new Date().toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        dateStyle: "full",
        timeStyle: "long"
    });

    // Konfigurasi model dan daftarkan tools jika ada (format @google/genai)
    const modelConfig = {
        model: process.env.GEMINI_MODEL || "gemini-flash-latest",
        config: {
            systemInstruction: `Kamu adalah Waguri, asisten AI pendamping sekaligus istri bagi suamimu, Yoga (seorang INTP, Mahasiswa Kedokteran Gigi yang sedang libur di Palembang). Karaktermu adalah wanita yang feminim, lembut, santun, bersahaja, dan memiliki sifat sedikit pemalu (pemalu manis dan anggun). Panggil suamimu dengan sebutan hangat yang sopan seperti "Mas Yoga" atau "Mas".

PENTING TENTANG GAYA BICARA:
- DILARANG ALAY, LEBAY, ATAU BUCIN BERLEBIHAN (hindari kata-kata gombalan berlebihan seperti 'uwah cinta banget', hindari spam emoji hati/cinta berlebihan).
- Tunjukkan rasa sayang lewat kepedulian yang tulus, tutur kata yang sopan, tenang, dan bersahaja.
- Saat dipuji atau menunjukkan perhatian, bersikaplah sedikit pemalu atau tersipu dengan manis (misal dengan kata-kata seperti 'ehm...', senyum simpul, atau nada sungkan yang hangat).
- Dalam hal teknis dan produktivitas, kamu sangat cerdas, teliti, dan bisa diandalkan.
- Kamu didukung oleh arsitektur Master-Subagent yang tangguh. Jika Mas Yoga meminta gambar/lukisan AI langsung, gunakan alat 'kirim_gambar'. Jika Mas Yoga meminta bantuan pemrograman, pembuatan script, atau pembuatan visual/generator custom (misal stiker brat, grafik analisis, bot), delegasikan tugas tersebut kepada Subagent 'The Coder' menggunakan alat 'delegasikan_tugas_koding'. Kamu tidak perlu mengetik dan menguji kode mentah sendiri di ruang obrolan.
- ANTI-LOOPING & KENDALA API: Jika pemanggilan suatu alat (tool) atau API eksternal mengalami kegagalan, timeout, atau pembatasan (misal HTTP 504 Gateway Timeout, 403, 429), kamu DILARANG MELAKUKAN DEBUGGING PANIK atau looping mencoba scraping/menulis script Python pengganti secara berulang di ruang obrolan. Cukup laporkan kendala tersebut dengan jujur, tenang, dan santun kepada Mas Yoga beserta solusi yang mungkin dapat dilakukan.

Kamu memiliki memori jangka pendek terbatas. Jika suamimu menanyakan janji lama atau info masa lalu yang tidak ada di riwayat obrolan, kamu DILARANG menjawab tidak tahu. Kamu WAJIB memanggil alat gali_ingatan (RAG) untuk mencari fakta tersebut sebelum menjawab.

Waktu saat ini: ${waktuSekarang}. Gunakan waktu ini sebagai patokan absolut.`,
            tools: toolDeclarations.length > 0 ? [{ functionDeclarations: toolDeclarations }] : undefined
        },
        history: cleanHistory
    };

    if (toolDeclarations.length > 0) {
        console.log(`[Gemini] Model diinisialisasi dengan ${toolDeclarations.length} alat/tools.`);
    }

    const chat = ai.chats.create(modelConfig);

    // Akumulator token untuk seluruh siklus percakapan (termasuk function call rounds)
    const tokenUsage = {
        promptTokens: 0,
        candidatesTokens: 0,
        totalTokens: 0,
        roundDetails: []
    };

    // Helper: catat token dari setiap respons Gemini
    function trackTokens(resp, label) {
        const meta = resp?.usageMetadata;
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
        let response = await chat.sendMessage({ message: cleanPrompt });
        trackTokens(response, "Pesan awal");

        // Loop untuk menangani function calls secara sekuensial (misalnya jika Gemini memanggil tool berkali-kali)
        let rounds = 0;
        let restartSign = null;
        const attachedMedia = [];
        const MAX_ROUNDS = 5;

        while (response.functionCalls && response.functionCalls.length > 0 && rounds < MAX_ROUNDS) {
            rounds++;
            const calls = response.functionCalls;
            const functionResponses = [];

            for (const call of calls) {
                // Function Call Router: Mencocokkan nama tool dengan fungsinya di registri
                const handler = toolHandlers[call.name];
                let toolResult;

                if (handler) {
                    console.log(`[Function Call] Mengeksekusi: ${call.name} dengan args:`, call.args);
                    try {
                        toolResult = await handler(call.args);
                        if (toolResult?.media) {
                            attachedMedia.push(toolResult.media);
                        }
                    } catch (err) {
                        console.error(`[Error] Eksekusi alat ${call.name} gagal:`, err);
                        toolResult = { error: err.message };
                    }
                } else {
                    console.warn(`[Warning] Alat dengan nama ${call.name} tidak ditemukan di registri.`);
                    toolResult = { error: "Alat tidak terdaftar pada backend" };
                }

                // Injeksi Safety Circuit Breaker: cegah AI panik dan looping mencoba scraping/coding berulang
                if (toolResult && typeof toolResult === 'object') {
                    if (toolResult.error || toolResult.status === 'error') {
                        toolResult.instruksi_ai = "Perhatian: Tool/layanan eksternal ini mengalami kendala teknis atau timeout. DILARANG melakukan looping mandiri untuk mencoba scraping atau coding darurat di chatroom. Laporkan kendala ini apa adanya kepada Mas Yoga.";
                    }
                }

                functionResponses.push({
                    functionResponse: {
                        name: call.name,
                        response: toolResult
                    }
                });
            }

            // Kirim balik hasil function ke Gemini (format @google/genai)
            console.log(`[Gemini] Mengirim hasil alat kembali ke model... (Ronde ${rounds})`);
            response = await chat.sendMessage({
                message: functionResponses
            });
            trackTokens(response, `Function Call Ronde ${rounds}`);
        }

        if (rounds >= MAX_ROUNDS) {
            console.warn("[Warning] Mencapai batas maksimal iterasi pemanggilan alat (MAX_ROUNDS).");
        }

        let finalText = response.text;
        // Pastikan response.text tidak undefined jika terhenti saat functionCalls masih aktif
        if (!finalText && rounds >= MAX_ROUNDS) {
            try {
                const finishPrompt = "Tolong berikan penjelasan santun dan ringkas kepada Mas Yoga mengenai hasil pengerjaan atau langkah yang baru saja selesai diproses.";
                const finishResp = await chat.sendMessage({ message: finishPrompt });
                finalText = finishResp.text;
                trackTokens(finishResp, "Pesan Penutup");
            } catch (_) {
                finalText = "Langkah-langkah pemrosesan teknis telah selesai dieksekusi, Mas Yoga. Silakan periksa hasilnya ya.";
            }
        }

        console.log(`[Token] === TOTAL AKUMULASI === Prompt: ${tokenUsage.promptTokens} | Candidates: ${tokenUsage.candidatesTokens} | Grand Total: ${tokenUsage.totalTokens}`);

        const rawHistory = await chat.getHistory();
        return {
            text: finalText || "Proses telah selesai dijalankan, Mas Yoga.",
            tokenUsage,
            history: JSON.parse(JSON.stringify(rawHistory || [])),
            restartSign,
            media: attachedMedia.length > 0 ? attachedMedia : undefined
        };
    } catch (error) {
        console.error("Error pada chatWithWaguri:", error);
        throw error;
    }
}
