import mongoose from 'mongoose';

const chatSessionSchema = new mongoose.Schema({
    deviceId: { 
        type: String, 
        required: true, 
        unique: true 
    },
    history: { 
        type: Array, 
        default: [] 
    }
}, { timestamps: true, versionKey: false });

export default mongoose.model('ChatSession', chatSessionSchema);
