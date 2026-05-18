export const declaration = {
    name: "tarik_data_cuaca",
    description: "Mengecek kondisi cuaca saat ini dan prakiraan 3 jam ke depan berdasarkan nama kota.",
    parameters: {
        type: "object",
        properties: {
            nama_kota: {
                type: "string",
                description: "Nama kota atau daerah yang ingin dicek cuacanya (contoh: Indralaya, Palembang)"
            }
        },
        required: ["nama_kota"]
    }
};

export async function execute(args) {
    const nama_kota = args.nama_kota;

    if (!nama_kota) {
        return { status: "error", message: "Parameter 'nama_kota' wajib diisi." };
    }

    try {
        // Langkah 1: Geocoding
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(nama_kota)}&count=1`;
        const geoResponse = await fetch(geoUrl);
        const geoData = await geoResponse.json();

        if (!geoData.results || geoData.results.length === 0) {
            return { status: "error", message: `Kota '${nama_kota}' tidak ditemukan.` };
        }

        const lokasi = geoData.results[0];
        const lat = lokasi.latitude;
        const lon = lokasi.longitude;
        const namaLengkap = `${lokasi.name}, ${lokasi.country || ''}`.trim();

        // Langkah 2: Tarik Cuaca Saat Ini + Prakiraan Per Jam + Paksa Zona Waktu Lokal (timezone=auto)
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,precipitation,weathercode&timezone=auto`;
        const weatherResponse = await fetch(weatherUrl);
        const weatherData = await weatherResponse.json();

        // Langkah 3: Filter Hemat Token (Ekstrak 3 jam ke depan saja)
        const waktuSekarang = new Date();
        // Cari index waktu di array hourly yang paling mendekati waktu saat ini
        const indeksSekarang = weatherData.hourly.time.findIndex(waktu => new Date(waktu) >= waktuSekarang);
        
        const prakiraanSingkat = [];
        // Ambil data untuk 3 jam ke depan dari index saat ini
        if (indeksSekarang !== -1) {
            for (let i = indeksSekarang; i < indeksSekarang + 3; i++) {
                if (weatherData.hourly.time[i]) {
                    prakiraanSingkat.push({
                        jam: weatherData.hourly.time[i].split("T")[1], // Ambil jamnya saja
                        suhu: weatherData.hourly.temperature_2m[i],
                        curah_hujan_mm: weatherData.hourly.precipitation[i]
                    });
                }
            }
        }

        // Kembalikan objek yang terstruktur, padat, dan hemat token ke Gemini
        return {
            status: "success",
            lokasi: namaLengkap,
            cuaca_saat_ini: {
                suhu_celsius: weatherData.current_weather.temperature,
                kode_cuaca: weatherData.current_weather.weathercode,
                waktu_lokal: weatherData.current_weather.time
            },
            prakiraan_3_jam_kedepan: prakiraanSingkat
        };

    } catch (error) {
        return { status: "error", message: `Gagal menarik data cuaca: ${error.message}` };
    }
}