const mongoose=require("mongoose");
const Chat = require("./models/chat.js"); 

async function seed() {
    try {
        await mongoose.connect(process.env.DB_URL || 'mongodb://127.0.0.1:27017/whatsapp');
        console.log("DB connected for seeding");

        const allChats=[
            { from:"neha", to:"priya", msg:"send me your exam sheets", created_at:new Date() },
            { from:"suman", to:"priya", msg:"send me your english sheets", created_at:new Date() },
            { from:"rahul", to:"priya", msg:"send me your dates", created_at:new Date() },
            { from:"mohit", to:"priya", msg:"send me your exam dates", created_at:new Date() },
            { from:"rohan", to:"priya", msg:"send me", created_at:new Date() }
        ];

        await Chat.insertMany(allChats);
        console.log("Seeding complete");
    } catch (err) {
        console.error("Seeding failed:", err);
        process.exitCode = 1;
    } finally {
        await mongoose.connection.close();
    }
}

seed();
