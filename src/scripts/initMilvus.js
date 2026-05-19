import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function initMilvus() {
    const milvusAddress = process.env.MILVUS_HOST + ':' + process.env.MILVUS_PORT;
    const collectionName = 'Memori_Waguri';

    console.log(`Menghubungkan ke Milvus di ${milvusAddress}...`);
    const milvusClient = new MilvusClient({ address: milvusAddress });

    try {
        // 2. Cek apakah koleksi sudah ada
        const hasCollection = await milvusClient.hasCollection({
            collection_name: collectionName,
        });

        if (hasCollection.value) {
            console.log(`Koleksi '${collectionName}' sudah ada.`);
        } else {
            console.log(`Koleksi '${collectionName}' belum ada. Membuat koleksi baru...`);
            
            // 3. Buat Koleksi berdasarkan skema
            await milvusClient.createCollection({
                collection_name: collectionName,
                fields: [
                    {
                        name: "id",
                        data_type: DataType.Int64,
                        is_primary_key: true,
                        autoID: true,
                    },
                    {
                        name: "vektor",
                        data_type: DataType.FloatVector,
                        dim: 768, // Sesuai dengan dimensi gemini-embedding-2 / gemini-embedding-1
                    },
                    {
                        name: "teks_asli",
                        data_type: DataType.VarChar,
                        max_length: 65535,
                    },
                    {
                        name: "kategori",
                        data_type: DataType.VarChar,
                        max_length: 255,
                    },
                    {
                        name: "tags",
                        data_type: DataType.JSON, // Menggunakan JSON agar langsung kompatibel dengan Array dari tanamIngatan.js
                    }
                ],
            });
            console.log(`Koleksi '${collectionName}' berhasil dibuat.`);
            
            // 4. Buat Indeks vektor
            console.log(`Membuat indeks untuk kolom 'vektor'...`);
            await milvusClient.createIndex({
                collection_name: collectionName,
                field_name: "vektor",
                index_type: "HNSW",
                metric_type: "IP", // Inner Product wajib untuk representasi vektor Gemini yang dinormalisasi
                params: { M: 16, efConstruction: 200 }
            });
            console.log(`Indeks HNSW berhasil dibuat.`);
        }

        // 5. Load koleksi ke dalam memori
        console.log(`Meload koleksi '${collectionName}' ke memori...`);
        await milvusClient.loadCollectionSync({
            collection_name: collectionName,
        });
        console.log(`Koleksi '${collectionName}' siap digunakan untuk pencarian.`);

    } catch (error) {
        console.error("Terjadi kesalahan saat inisialisasi Milvus:", error);
    } finally {
        // Tutup koneksi agar skrip bisa selesai
        await milvusClient.closeConnection();
    }
}

initMilvus();
