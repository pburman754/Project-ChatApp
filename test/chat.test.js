const request = require('supertest');
const { expect } = require('chai');
const { app, startServer } = require('../index.js');
const mongoose = require('mongoose');
const User = require('../models/user.js');
const Chat = require('../models/chat.js');
const { MongoMemoryServer } = require('mongodb-memory-server');

describe('Chat Application', () => {
    let server;
    let agent;
    let mongoServer;

    before(async function() {
        this.timeout(60000); // Set a longer timeout for the before hook to download MongoDB if needed

        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();

        await mongoose.connect(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        server = await new Promise((resolve) => {
            startServer(0, (s) => resolve(s));
        });
        agent = request.agent(app);

        // Clear existing test data
        await User.deleteMany({});
        await Chat.deleteMany({});

        // Create and login a test user
        const user = new User({ username: 'testuser', email: 'test@example.com' });
        await User.register(user, 'password');

        await agent
            .post('/login')
            .type('form')
            .send({ username: 'testuser', password: 'password' })
            .expect(302)
            .expect('Location', '/chats');

        // Create another user for conversations
        const otherUser = new User({ username: 'otheruser', email: 'other@example.com' });
        await User.register(otherUser, 'password');
    });

    after(async () => {
        await mongoose.disconnect();
        await mongoServer.stop();
        server.close();
    });

    describe('GET /chats', () => {
        before(async () => {
            // Seed with test chats
            await Chat.insertMany([
                { from: 'testuser', to: 'otheruser', msg: 'Hello', created_at: new Date(Date.now() - 10000) },
                { from: 'otheruser', to: 'testuser', msg: 'Hi there', created_at: new Date(Date.now() - 5000) },
                { from: 'testuser', to: 'anotheruser', msg: 'Hey', created_at: new Date() }
            ]);
        });

        it('should display a single, latest message for each conversation, avoiding duplicates', async () => {
            const res = await agent.get('/chats').expect(200);

            // 1. Verify that the view logic is simplified
            expect(res.text).to.not.include('<!-- Group chats by conversation -->');

            // 2. Verify correct conversations are present
            expect(res.text).to.include('Conversation with: <strong>otheruser</strong>');
            expect(res.text).to.include('Conversation with: <strong>anotheruser</strong>');

            // 3. Verify only the LATEST message is shown for the two-way conversation
            expect(res.text).to.include('<p class="text-muted mb-0">Hi there</p>');
            expect(res.text).to.not.include('<p class="text-muted mb-0">Hello</p>');

            // 4. CRITICAL: Verify that the conversation with 'otheruser' is not duplicated
            const otheruserConvoCount = (res.text.match(/Conversation with: <strong>otheruser<\/strong>/g) || []).length;
            expect(otheruserConvoCount).to.equal(1);
        });
    });
});