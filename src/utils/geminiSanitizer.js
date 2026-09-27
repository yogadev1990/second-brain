/**
 * Membersihkan riwayat obrolan agar selalu mematuhi aturan ketat Gemini API:
 * 1. Menyaring intermediate functionCall dan functionResponse lama menjadi dialog teks bersih.
 * 2. Mencegah error 400 'Please ensure that function response turn comes immediately after a function call turn'.
 * 3. Menjamin giliran dialog bergantian (user -> model) dan turn pertama selalu role 'user'.
 */
export function sanitizeGeminiHistory(rawHistory) {
    if (!Array.isArray(rawHistory) || rawHistory.length === 0) return [];

    const clean = [];
    for (const turn of rawHistory) {
        if (!turn || !turn.role || !Array.isArray(turn.parts)) continue;

        // Ambil hanya teks dari parts (abaikan intermediate functionCall / functionResponse internal lama)
        const textParts = turn.parts
            .filter(p => typeof p?.text === 'string' && p.text.trim() !== '')
            .map(p => ({ text: p.text }));

        if (textParts.length > 0) {
            // Cegah dua turn beruntun dengan role yang sama
            const lastTurn = clean[clean.length - 1];
            if (lastTurn && lastTurn.role === turn.role) {
                lastTurn.parts.push(...textParts);
            } else {
                clean.push({
                    role: turn.role,
                    parts: textParts
                });
            }
        }
    }

    // Pastikan turn pertama adalah role 'user'
    while (clean.length > 0 && clean[0].role !== 'user') {
        clean.shift();
    }

    return clean;
}
