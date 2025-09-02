const mongoose=require("mongoose");

const chatSchema=new mongoose.Schema({
    from:{
        type:String,
        required:true
    },
    to:{
        type:String,
        required:true
    },
    msg:{
        type:String,
        maxLength:50
    },
    created_at:{
        type:Date,
        required:true
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    status: {
        type: String,
        enum: ['sent', 'delivered', 'read'],
        default: 'sent'
    }
});

const Chat=mongoose.model("Chat",chatSchema);
module.exports=Chat;