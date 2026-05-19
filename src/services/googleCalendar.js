import { google } from 'googleapis';
import { oauth2Client } from './googleAuth.js'; // Mengambil kunci yang sudah kita buat

export const sinkronisasiKeKalender = async (namaKegiatan, waktuMulaiIso, durasiMenit) => {
    try {
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        const startTime = new Date(waktuMulaiIso);
        // Jika jadwal tidak punya durasi (0), kita patok default 30 menit agar bloknya terlihat di UI Kalender
        const durasiAktual = durasiMenit > 0 ? durasiMenit : 30; 
        const endTime = new Date(startTime.getTime() + durasiAktual * 60000);

        const event = {
            summary: namaKegiatan,
            description: 'Dijadwalkan secara otonom oleh Waguri.',
            start: {
                dateTime: startTime.toISOString(),
                timeZone: 'Asia/Jakarta',
            },
            end: {
                dateTime: endTime.toISOString(),
                timeZone: 'Asia/Jakarta',
            },
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'popup', minutes: 15 }, // Notifikasi bawaan Google
                ],
            },
        };

        // Menembakkan data ke API Google
        const response = await calendar.events.insert({
            calendarId: 'primary', // Kalender utama milikmu
            resource: event,
        });

        console.log(`[Google Calendar] ✅ Berhasil menyinkronkan: "${namaKegiatan}"`);
        return response.data.htmlLink;
    } catch (error) {
        console.error('[Google Calendar] ❌ Gagal menyinkronkan jadwal:', error.message);
        return null;
    }
};
