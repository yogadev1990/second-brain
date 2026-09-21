# Waguri Skills & Tool Catalog

Katalog fungsi/tool yang terdaftar secara dinamis ke Gemini 2.5 Flash / 3.8 Flash via `src/tools/index.js`.

---

## 1. Memori & Pengetahuan (The Archivist)
- **`cari_ingatan_hybrid`**
  - *Deskripsi:* Menggali fakta masa lalu, preferensi pengguna, atau catatan medis menggunakan algoritma Hybrid Search RRF (Milvus Vector 768-dim + MongoDB Text Index).
  - *File:* `src/tools/memori/cariIngatanHybrid.js`
- **`tanam_ingatan`**
  - *Deskripsi:* Menyimpan memori baru, pengetahuan abstrak, atau ide ke dalam Milvus dan MongoDB.
  - *File:* `src/tools/memori/tanamIngatan.js`
- **`gali_ingatan`**
  - *Deskripsi:* Pencarian memori semantik berbasis Milvus (legacy RAG).
  - *File:* `src/tools/memori/galiIngatan.js`

## 2. Infrastruktur & DevOps (The Watchdog)
- **`restart_container`**
  - *Deskripsi:* Me-restart container Docker spesifik secara aman melalui Docker Engine API.
  - *File:* `src/tools/vps/restartContainer.js`
- **`baca_log_docker`**
  - *Deskripsi:* Membaca 50 baris terakhir log container Docker untuk diagnosis error.
  - *File:* `src/tools/vps/bacaLogDocker.js`
- **`cek_status_docker`**
  - *Deskripsi:* Memeriksa daftar container yang sedang aktif di host VPS.
  - *File:* `src/tools/vps/cekStatusDocker.js`
- **`cek_metrik_vps`**
  - *Deskripsi:* Membaca metrik utilisasi RAM, CPU, dan uptime server.
  - *File:* `src/tools/vps/cekMetrik.js`
- **`perbarui_sistem_waguri`**
  - *Deskripsi:* Memicu kemampuan self-evolution untuk mengedit kode sumber, rebuild image kandidat, menguji /health, dan mengganti kernel kontainer Waguri sendiri secara Blue-Green tanpa downtime.
  - *File:* `src/tools/vps/perbaruiSistemWaguri.js`
- **`perbarui_kontainer_layanan`**
  - *Deskripsi:* Memperbarui kontainer layanan lain (seperti toko online 'revandastore-app', 'wiki-web', dll) via The Watchdog dengan strategi Blue-Green Deployment dan proteksi Auto-Repair / Safe Rollback.
  - *File:* `src/tools/vps/perbaruiKontainerLayanan.js`



## 3. IoT & Kontrol Fisik (The Caretaker)
- **`kontrol_perangkat_kamar`**
  - *Deskripsi:* Mengendalikan saklar lampu USB meja dan memperbarui teks pada Layar Meja AMOLED 2.06" ESP32-S3 via MQTT.
  - *File:* `src/tools/android/kontrolKamarIot.js`

## 4. Jadwal & Mobilitas
- **`tambah_jadwal`**
  - *Deskripsi:* Menambahkan rutinitas, kuota target, atau janji temu statis ke database kalender dan sinkronisasi ke Google Calendar.
  - *File:* `src/tools/jadwal/tambah_jadwal.js`

## 5. Eksternal & Keuangan
- **`tarik_data_cuaca`**
  - *Deskripsi:* Mengecek kondisi dan prakiraan cuaca kota (contoh: Palembang) via Open-Meteo.
  - *File:* `src/tools/eksternal/cekCuaca.js`
- **`gali_berita_pasar`**
  - *Deskripsi:* Mengambil ringkasan sentimen berita keuangan, IHSG, atau kripto via Google News RSS.
  - *File:* `src/tools/keuangan/gali_berita_pasar.js`
- **`perbarui_portofolio_aset`**
  - *Deskripsi:* Memperbarui pencatatan kepemilikan aset finansial di database.
  - *File:* `src/tools/keuangan/perbarui_portofolio_aset.js`
