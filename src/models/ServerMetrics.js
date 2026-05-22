import mongoose from 'mongoose';

const serverMetricsSchema = new mongoose.Schema({
    type: { type: String, default: 'global', unique: true },
    monthlyTokenUsage: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model('ServerMetrics', serverMetricsSchema);
