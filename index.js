const express = require("express");
const app = express();
const mongoose = require("mongoose");
const path = require("path");
const Chat = require("./models/chat.js");
const methodOverride = require("method-override");
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local');
const User = require('./models/user.js');
const flash = require('connect-flash');
const http = require('http');
const socketIo = require('socket.io');

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));

const sessionOptions = {
    secret: process.env.SECRET || 'supersecret',
    resave: false,
    saveUninitialized: true,
    cookie: {
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly: true
    }
};

app.use(session(sessionOptions));
app.use(flash());
app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

main()
    .then(() => {
        console.log("connection successfull");
    })
    .catch((err) => console.log(err));

async function main() {
    await mongoose.connect(process.env.DB_URL || 'mongodb://127.0.0.1:27017/whatsapp', {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 30000
    });
}

const isLoggedIn = (req, res, next) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/auth');
    }
    next();
}

// ... existing code
app.get("/", (req, res) => {
    res.redirect("/chats");
});

app.get("/chats", isLoggedIn, async (req, res) => {
    let allChats = await Chat.find({
        $or: [
            { from: req.user.username },
            { to: req.user.username }
        ]
    }).sort({ created_at: -1 });

    const conversations = {};
    allChats.forEach(chat => {
        const otherUser = chat.from === req.user.username ? chat.to : chat.from;
        if (!conversations[otherUser] || chat.created_at > conversations[otherUser].created_at) {
            conversations[otherUser] = chat;
        }
    });

    const chats = Object.values(conversations).sort((a, b) => b.created_at - a.created_at);

    res.render("index.ejs", { chats, currentUser: req.user, success: req.flash('success'), error: req.flash('error') });
});

app.get("/chats/new", isLoggedIn, (req, res) => {
    res.render("new.ejs", { currentUser: req.user, success: req.flash('success'), error: req.flash('error') });
});
// ... existing code

app.post("/chats", isLoggedIn, async (req, res) => {
    try {
        let { from, msg, to } = req.body;

        if (from === to) {
            req.flash('error', 'You cannot send a message to yourself.');
            return res.redirect("/chats/new");
        }

        let newChat = new Chat({
            from: from,
            to: to,
            msg: msg,
            created_at: new Date(),
            owner: req.user._id
        });
        const savedChat = await newChat.save();
        console.log("chat was saved via HTTP");

        // Emit real-time updates so both sender and receiver see it immediately
        const ioInstance = req.app.get('io');
        if (ioInstance) {
            // Sender by userId
            ioInstance.to(req.user._id.toString()).emit('messageReceived', savedChat);
            // Receiver by username
            ioInstance.to(to).emit('messageReceived', savedChat);
            // Best-effort receiver by userId lookup
            try {
                const recipient = await User.findOne({ username: to });
                if (recipient && recipient._id) {
                    ioInstance.to(recipient._id.toString()).emit('messageReceived', savedChat);
                }
            } catch (lookupErr) {
                console.error('Failed to look up recipient for HTTP emit:', lookupErr);
            }
        }

        res.redirect("/chats");
    } catch (err) {
        console.log(err);
        res.redirect("/chats");
    }
});

app.get("/chats/conversation/:participants", isLoggedIn, async (req, res) => {
    try {
        let { participants } = req.params;
        let [p1, p2] = participants.split('-');
        let chats = await Chat.find({
            $or: [
                { from: p1, to: p2 },
                { from: p2, to: p1 }
            ]
        }).sort({ created_at: 1 }); // Ensure messages are sorted by creation time

        const conversation = {
            participants: [p1, p2],
            messages: chats
        };

        res.render("chat.ejs", { conversation, currentUser: req.user, success: req.flash('success'), error: req.flash('error') });
    } catch (error) {
        console.error('Error fetching conversation:', error);
        req.flash('error', 'Failed to load conversation.');
        res.redirect('/chats');
    }
});

app.get("/chats/:id/edit", isLoggedIn, async (req, res) => {
    let { id } = req.params;
    let chat = await Chat.findById(id);
    if (!chat.owner.equals(req.user._id)) {
        return res.redirect("/chats");
    }
    res.render("edit.ejs", { chat, currentUser: req.user, success: req.flash('success'), error: req.flash('error') });

});

app.put("/chats/:id", isLoggedIn, async (req, res) => {
    let { id } = req.params;
    let { newMsg } = req.body;
    let updateChat = await Chat.findByIdAndUpdate(
        id,
        { msg: newMsg },
        { runValidators: true, new: true }
    );
    console.log(updateChat);
    res.redirect("/chats");
});

app.delete("/chats/:id", isLoggedIn, async (req, res) => {
    let { id } = req.params;
    await Chat.findByIdAndDelete(id);
    res.redirect("/chats");
})

app.delete("/chats/conversation/:participants", isLoggedIn, async (req, res) => {
    try {
        const { participants } = req.params;
        const [p1, p2] = participants.split('-');
        await Chat.deleteMany({
            $or: [
                { from: p1, to: p2 },
                { from: p2, to: p1 },
            ],
        });
        req.flash('success', 'Conversation deleted successfully.');
        res.redirect('/chats');
    } catch (error) {
        console.error('Error deleting conversation:', error);
        req.flash('error', 'Failed to delete conversation.');
        res.redirect('/chats');
    }
});

app.get("/auth", (req, res) => {
    res.render("auth.ejs", { success: req.flash('success'), error: req.flash('error') });
});

app.get("/login", (req, res) => {
    res.render("login.ejs", { error: req.flash('error'), success: req.flash('success') });
});

app.get("/signup", (req, res) => {
    res.render("signup.ejs", { error: req.flash('error'), success: req.flash('success') });
});

app.post('/signup', async (req, res, next) => {
    try {
        let { username, email, password } = req.body;
        const newUser = new User({ email, username });
        const registeredUser = await User.register(newUser, password);
        req.flash('success', 'Account created successfully! Please login to continue.');
        res.redirect('/login');
    } catch (e) {
        req.flash('error', 'Username or email already exists. Please try again.');
        res.redirect('/signup');
    }
});

app.post('/login', passport.authenticate('local', { 
    failureRedirect: '/login',
    failureFlash: 'Invalid username or password. Please try again.'
}), (req, res) => {
    res.redirect('/chats');
});

app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        res.redirect('/auth');
    });
});

// Create HTTP server and Socket.IO instance
const server = http.createServer(app);
const io = socketIo(server);
app.set('io', io);

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Join user to their personal room
    socket.on('join', (userId) => {
        socket.join(userId);
        console.log(`User ${userId} joined their room`);
    });

    // Also join a room by username for direct emits without DB lookup
    socket.on('joinUsername', (username) => {
        if (username) {
            socket.join(username);
            console.log(`User joined username room: ${username}`);
        }
    });

    // Handle new message
    socket.on('newMessage', async (data) => {
        try {
            const { from, to, msg, owner } = data;

            if (from === to) {
                socket.emit('error', 'You cannot send a message to yourself.');
                return;
            }

            const newChat = new Chat({
                from: from,
                to: to,
                msg: msg,
                created_at: new Date(),
                owner: owner
            });
            
            const savedChat = await newChat.save();
            console.log("Real-time chat saved:", savedChat);

            // Emit to the sender (owner)
            io.to(owner).emit('messageReceived', savedChat);

            // Best-effort emit to receiver by userId if found
            try {
                const recipient = await User.findOne({ username: to });
                if (recipient && recipient._id) {
                    io.to(recipient._id.toString()).emit('messageReceived', savedChat);
                }
            } catch (lookupErr) {
                console.error('Failed to look up recipient for real-time emit:', lookupErr);
            }
        } catch (error) {
            console.error('Error saving real-time message:', error);
            socket.emit('error', 'Failed to send message');
        }
    });

    // Handle typing event
    socket.on('typing', (data) => {
        // Broadcast to the recipient's username room
        socket.to(data.to).emit('typing', { from: data.from });
    });

    // Handle stop typing event
    socket.on('stop typing', (data) => {
        // Broadcast to the recipient's username room
        socket.to(data.to).emit('stop typing', { from: data.from });
    });

    // Handle message update
    socket.on('updateMessage', async (data) => {
        try {
            const { messageId, newMsg, owner } = data;
            const updatedChat = await Chat.findByIdAndUpdate(
                messageId,
                { msg: newMsg },
                { runValidators: true, new: true }
            );
            
            if (updatedChat) {
                // Emit to the owner
                io.to(owner).emit('messageUpdated', updatedChat);
                // Emit to all users
                io.emit('chatMessageUpdated', updatedChat);
                // Emit conversation update
                io.emit('conversationUpdate', updatedChat);
            }
        } catch (error) {
            console.error('Error updating message:', error);
            socket.emit('error', 'Failed to update message');
        }
    });

    // Handle message delivered event
    socket.on('messageDelivered', async (data) => {
        try {
            const { messageId, recipientId } = data;
            const updatedChat = await Chat.findByIdAndUpdate(
                messageId,
                { status: 'delivered' },
                { new: true }
            );
            if (updatedChat) {
                // Emit to the sender
                io.to(updatedChat.owner.toString()).emit('messageStatusUpdate', updatedChat);
                // Emit to the recipient (if they are still connected and in their room)
                io.to(recipientId).emit('messageStatusUpdate', updatedChat);
            }
        } catch (error) {
            console.error('Error updating message status to delivered:', error);
        }
    });

    // Handle message read event
    socket.on('messageRead', async (data) => {
        try {
            const { messageId, readerId } = data;
            const updatedChat = await Chat.findByIdAndUpdate(
                messageId,
                { status: 'read' },
                { new: true }
            );
            if (updatedChat) {
                // Emit to the sender
                io.to(updatedChat.owner.toString()).emit('messageStatusUpdate', updatedChat);
                // Emit to the reader (if they are still connected and in their room)
                io.to(readerId).emit('messageStatusUpdate', updatedChat);
            }
        } catch (error) {
            console.error('Error updating message status to read:', error);
        }
    });

    // Handle message deletion
    socket.on('deleteMessage', async (data) => {
        try {
            const { messageId, owner } = data;
            await Chat.findByIdAndDelete(messageId);
            
            // Emit to the owner
            io.to(owner).emit('messageDeleted', messageId);
            // Emit to all users
            io.emit('chatMessageDeleted', messageId);
            // Emit conversation update to refresh main area
            io.emit('conversationDeleted', messageId);
        } catch (error) {
            console.error('Error deleting message:', error);
            socket.emit('error', 'Failed to delete message');
        }
    });

    // Handle conversation deletion
    socket.on('deleteConversation', async (data) => {
        try {
            const { participants } = data;
            const [from, to] = participants.split('-');
            
            // Delete all messages in this conversation
            await Chat.deleteMany({
                $or: [
                    { from: from, to: to },
                    { from: to, to: from }
                ]
            });
            
            // Emit to all users
            io.emit('conversationDeleted', { participants: participants });
        } catch (error) {
            console.error('Error deleting conversation:', error);
            socket.emit('error', 'Failed to delete conversation');
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PREFERRED_PORT = Number(process.env.PORT) || 8080;

function startServer(port) {
    server.listen(port, () => {
        const addressInfo = server.address();
        const actualPort = typeof addressInfo === 'object' && addressInfo ? addressInfo.port : port;
        console.log(`server is running with Socket.IO on port ${actualPort}`);
    });
}

server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
        console.warn(`Port ${PREFERRED_PORT} in use, retrying on a random available port...`);
        // Retry on a random available port
        startServer(0);
    } else {
        throw err;
    }
});

startServer(PREFERRED_PORT);