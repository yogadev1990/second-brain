import { google } from 'googleapis';
import GoogleToken from '../models/GoogleToken.js';
import dotenv from 'dotenv';
dotenv.config();

// Konfigurasi Kredensial dari .env
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

// Target Invasi Pertama: Google Calendar (Event)
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

export const getAuthUrl = () => {
    return oauth2Client.generateAuthUrl({
        access_type: 'offline', // Wajib offline agar kita mendapat Refresh Token
        prompt: 'consent',      // Memaksa Google mengeluarkan Refresh Token baru
        scope: SCOPES,
    });
};

export const saveTokens = async (code) => {
    // Menukar kode dari URL dengan Token valid dari Google
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Menyimpan/Memperbarui token ke MongoDB
    await GoogleToken.findOneAndUpdate(
        { user: 'randa_intp' },
        { ...tokens, user: 'randa_intp' },
        { upsert: true, new: true }
    );
    console.log('✅ Brankas Token Google berhasil diperbarui di MongoDB.');
    return tokens;
};

// Fungsi ini akan dipanggil saat server pertama menyala untuk memuat ingatan token
export const initGoogleAuth = async () => {
    try {
        const tokenDoc = await GoogleToken.findOne({ user: 'randa_intp' });
        if (tokenDoc && tokenDoc.access_token) {
            oauth2Client.setCredentials({
                access_token: tokenDoc.access_token,
                refresh_token: tokenDoc.refresh_token,
                scope: tokenDoc.scope,
                token_type: tokenDoc.token_type,
                expiry_date: tokenDoc.expiry_date
            });
            console.log('✅ Ingatan Kredensial Google Workspace berhasil dimuat.');
        } else {
            console.log('⚠️ Kredensial Google belum ada. Menunggu otorisasi Randa...');
        }
    } catch (err) {
        console.error('Gagal memuat kredensial Google:', err);
    }
};

export { oauth2Client };