import mongoose from 'mongoose';

const googleTokenSchema = new mongoose.Schema({
    user: { type: String, default: 'randa_intp' }, // ID tunggal karena ini asisten pribadimu
    access_token: String,
    refresh_token: String,
    scope: String,
    token_type: String,
    expiry_date: Number
});

export default mongoose.model('GoogleToken', googleTokenSchema);