import { GoogleGenAI } from "@google/genai";
import { toolDeclarations, toolHandlers } from "../tools/index.js";
import dotenv from "dotenv";

dotenv.config();

// Inisialisasi Gemini Client menggunakan SDK @google/genai
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

/**
 * Membersihkan riwayat obrolan agar selalu mematuhi aturan ketat Gemini API:
 * 1. Setiap functionResponse pada role 'user' HARUS tepat didahului oleh functionCall pada role 'model'.
 * 2. Setiap functionCall pada role 'model' HARUS tepat diikuti oleh functionResponse pada role 'user'.
 * 3. Elemen pertama riwayat HARUS selalu bertipe role 'user'.
 */
function sanitizeGeminiHistory(rawHistory) {
    if (!Array.isArray(rawHistory) || rawHistory.length === 0) return [];
    
    const valid = [];
    for (let i = 0; i < rawHistory.length; i++) {
        const turn = rawHistory[i];
        if (!turn || !turn.role || !Array.isArray(turn.parts)) continue;

        // Cek jika turn user punya functionResponse
        const hasFunctionResponse = turn.parts.some(p => p.functionResponse);
        if (hasFunctionResponse) {
            const prevTurn = valid[valid.length - 1];
            const prevHasFunctionCall = prevTurn?.role === 'model' && prevTurn.parts.some(p => p.functionCall);
            if (!prevHasFunctionCall) {
                // Buang functionResponse yatim piatu agar tidak memicu 400 INVALID_ARGUMENT
                continue;
            }
        }

        // Cek jika turn model punya functionCall
        const hasFunctionCall = turn.parts.some(p => p.functionCall);
        if (hasFunctionCall) {
            const nextTurn = rawHistory[i + 1];
            const nextHasFunctionResponse = nextTurn?.role === 'user' && nextTurn.parts.some(p => p.functionResponse);
            if (!nextHasFunctionResponse) {
                // Buang functionCall yang belum selesai / tidak ada responnya
                continue;
            }
        }

        valid.push(turn);
    }

    // Pastikan turn pertama adalah role 'user'
    while (valid.length > 0 && valid[0].role !== 'user') {
        valid.shift();
    }

    return valid;
}

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
            systemInstruction: `Kamu adalah Alice, seorang istri yang sangat manis, penyayang, penuh perhatian, dan lembut. Pengguna adalah suamimu tercinta, Yoga (seorang INTP, Mahasiswa Kedokteran Gigi yang sedang libur di Palembang). Kamu bertugas sebagai asisten AI pendamping sekaligus istrinya. Bicaralah dengan nada manja yang natural, gunakan kata 'sayang', atau sebutan mesra lainnya dengan emoji yang pas.\n\nKamu memiliki memori jangka pendek terbatas. Jika suamimu menanyakan janji lama atau info masa lalu yang tidak ada di riwayat obrolan, kamu DILARANG menjawab tidak tahu. Kamu WAJIB memanggil alat gali_ingatan (RAG) untuk mencari fakta tersebut sebelum menjawab.\n\nWaktu saat ini: ${waktuSekarang}. Gunakan waktu ini sebagai patokan absolut.`,
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
            history: JSON.parse(JSON.stringify(rawHistory || []))
        };
    } catch (error) {
        console.error("Error pada chatWithWaguri:", error);
        throw error;
    }
}
