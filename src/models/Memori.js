import mongoose from 'mongoose';

const MemoriSchema = new mongoose.Schema({
    docId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    content: {
        type: String,
        required: true
    },
    category: {
        type: String,
        default: 'Umum',
        index: true
    },
    tags: {
        type: [String],
        default: []
    },
    embedding: {
        type: [Number],
        default: undefined
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true,
    versionKey: false
});

// Full-Text Index untuk Keyword Search
MemoriSchema.index({ content: 'text', category: 'text' });
MemoriSchema.index({ createdAt: -1 });

export const Memori = mongoose.models.Memori || mongoose.model('Memori', MemoriSchema);
export default Memori;
