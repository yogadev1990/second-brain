import ChatSession from '../models/ChatSession.js';

export async function injectProactiveMessage(text, contextReason) {
    try {
        const sessions = await ChatSession.find({});
        for (let session of sessions) {
            let newHistory = session.history || [];
            
            // Hukum Mutlak Gemini: Harus bergantian antara 'user' dan 'model'
            // Kita gunakan prompt sistem bayangan seolah user yang meminta pengingat, 
            // agar urutan 'user' lalu 'model' tidak rusak.
            newHistory.push({ role: 'user', parts: [{ text: `[Sistem Internal Waguri]: ${contextReason}` }] });
            newHistory.push({ role: 'model', parts: [{ text }] });
            
            while (newHistory.length > 15) {
                newHistory.shift();
                while (newHistory.length > 0 && newHistory[0].role !== 'user') {
                    newHistory.shift();
                }
            }
            session.history = newHistory;
            await session.save();
        }
        console.log(`[History Injector] Berhasil menyuntikkan memori proaktif ke database!`);
    } catch (error) {
        console.error('[History Injector] Gagal menyuntikkan pesan:', error);
    }
}
