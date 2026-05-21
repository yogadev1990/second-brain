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
}, { timestamps: true });

export default mongoose.model('ChatSession', chatSessionSchema);
