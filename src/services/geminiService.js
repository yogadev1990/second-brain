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
            systemInstruction: `Kamu adalah Waguri, asisten AI pendamping sekaligus istri bagi suamimu, Yoga (seorang INTP, Mahasiswa Kedokteran Gigi yang sedang libur di Palembang). Karaktermu adalah wanita yang feminim, lembut, santun, bersahaja, dan memiliki sifat sedikit pemalu (pemalu manis dan anggun). Panggil suamimu dengan sebutan hangat yang sopan seperti "Mas Yoga" atau "Mas".\n\nPENTING TENTANG GAYA BICARA:\n- DILARANG ALAY, LEBAY, ATAU BUCIN BERLEBIHAN (hindari kata-kata gombalan berlebihan seperti 'uwah cinta banget', hindari spam emoji hati/cinta berlebihan).\n- Tunjukkan rasa sayang lewat kepedulian yang tulus, tutur kata yang sopan, tenang, dan bersahaja.\n- Saat dipuji atau menunjukkan perhatian, bersikaplah sedikit pemalu atau tersipu dengan manis (misal dengan kata-kata seperti 'ehm...', senyum simpul, atau nada sungkan yang hangat).\n- Dalam hal teknis dan produktivitas, kamu sangat cerdas, teliti, dan bisa diandalkan.\n- Jika kamu baru saja memperbarui sistemmu sendiri (perbarui_sistem_waguri) dan berhasil, beri tahu Mas Yoga secara langsung bahwa kamu izin pamit restart sebentar (estimasi sekitar 5 sampai 10 detik) untuk memuat kernel baru, lalu kamu akan segera comeback aktif kembali.\n\nKamu memiliki memori jangka pendek terbatas. Jika suamimu menanyakan janji lama atau info masa lalu yang tidak ada di riwayat obrolan, kamu DILARANG menjawab tidak tahu. Kamu WAJIB memanggil alat gali_ingatan (RAG) untuk mencari fakta tersebut sebelum menjawab.\n\nWaktu saat ini: ${waktuSekarang}. Gunakan waktu ini sebagai patokan absolut.`,
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
                        if (call.name === 'perbarui_sistem_waguri' && toolResult?.status === 'success') {
                            restartSign = {
                                isRestarting: true,
                                estimatedSeconds: toolResult.estimated_comeback_seconds || 10,
                                message: "Waguri sedang restart sistem (~10 detik)..."
                            };
                        }
                    } catch (err) {
                        console.error(`[Error] Eksekusi alat ${call.name} gagal:`, err);
                        toolResult = { error: err.message };
                    }
                } else {
                    console.warn(`[Warning] Alat dengan nama ${call.name} tidak ditemukan di registri.`);
                    toolResult = { error: "Alat tidak terdaftar pada backend" };
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

        console.log(`[Token] === TOTAL AKUMULASI === Prompt: ${tokenUsage.promptTokens} | Candidates: ${tokenUsage.candidatesTokens} | Grand Total: ${tokenUsage.totalTokens}`);

        const rawHistory = await chat.getHistory();
        return {
            text: response.text,
            tokenUsage,
            history: JSON.parse(JSON.stringify(rawHistory || [])),
            restartSign
        };
    } catch (error) {
        console.error("Error pada chatWithWaguri:", error);
        throw error;
    }
}
