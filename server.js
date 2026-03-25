const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./database');

// Create uploads folder if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Create app and server
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const fileUrl = `/uploads/${req.file.filename}`;
    const fileType = req.file.mimetype;
    const fileName = req.file.originalname;
    const fileSize = req.file.size;
    
    res.json({
        success: true,
        fileUrl: fileUrl,
        fileName: fileName,
        fileType: fileType,
        fileSize: fileSize
    });
});

// Store online users
let users = {};
let messages = []; // Group messages cache
let privateMessages = {}; // Private messages cache

// Helper to create a unique room key for private chats
function getPrivateRoomKey(user1, user2) {
    return [user1, user2].sort().join('_');
}

io.on('connection', (socket) => {
    console.log('🔌 User connected:', socket.id);
    
    // User sets their username
    socket.on('set-username', (username) => {
        const usernameTaken = Object.values(users).some(user => user === username);
        
        if (usernameTaken) {
            socket.emit('username-taken');
            return;
        }
        
        users[socket.id] = username;
        socket.username = username;
        
        // Load messages from database
        db.getRecentGroupMessages((dbMessages) => {
            messages = dbMessages;
            socket.emit('previous-messages', messages);
        });
        
        updateOnlineUsers();
        io.emit('user-joined', `${username} joined the chat`);
        
        console.log(`✅ ${username} joined the chat`);
        console.log('👥 Active users:', Object.values(users));
    });
    
    function updateOnlineUsers() {
        const onlineUsers = Object.values(users);
        io.emit('online-users', onlineUsers);
    }
    
    // Group chat messages (text, images, files, voice)
    socket.on('send-message', (messageData) => {
        const username = users[socket.id];
        if (!username) return;
        
        const message = {
            id: Date.now() + Math.random(),
            username: username,
            timestamp: new Date().toLocaleTimeString(),
            type: messageData.type || 'text',
            reactions: {}
        };
        
        if (messageData.type === 'image') {
            message.imageUrl = messageData.imageUrl;
            message.text = messageData.text || '';
        } else if (messageData.type === 'file') {
            message.fileUrl = messageData.fileUrl;
            message.fileName = messageData.fileName;
            message.fileType = messageData.fileType;
            message.fileSize = messageData.fileSize;
            message.text = messageData.text || '';
        } else if (messageData.type === 'voice') {
            message.voiceUrl = messageData.voiceUrl;
            message.duration = messageData.duration;
        } else {
            message.text = messageData.text;
        }
        
        // Save to database
        db.saveGroupMessage(message, (savedMessage) => {
            messages.push(message);
            // Keep only last 100 messages
            if (messages.length > 100) messages.shift();
            // Broadcast to all users
            io.emit('new-message', message);
            console.log(`💬 [GROUP] ${username}: ${message.text || message.type || 'message'}`);
        });
    });
    
    // Private messages with files and voice
    socket.on('send-private-message', ({ to, text, type, imageUrl, fileUrl, fileName, fileType, fileSize, voiceUrl, duration }) => {
        const fromUsername = users[socket.id];
        if (!fromUsername) return;
        
        const recipientSocketId = Object.keys(users).find(id => users[id] === to);
        
        const message = {
            id: Date.now() + Math.random(),
            from: fromUsername,
            to: to,
            timestamp: new Date().toLocaleTimeString(),
            type: type || 'text',
            reactions: {}
        };
        
        if (type === 'image') {
            message.imageUrl = imageUrl;
            message.text = text || '';
        } else if (type === 'file') {
            message.fileUrl = fileUrl;
            message.fileName = fileName;
            message.fileType = fileType;
            message.fileSize = fileSize;
            message.text = text || '';
        } else if (type === 'voice') {
            message.voiceUrl = voiceUrl;
            message.duration = duration;
        } else {
            message.text = text;
        }
        
        // Save to database
        db.savePrivateMessage(message, () => {
            const roomKey = getPrivateRoomKey(fromUsername, to);
            if (!privateMessages[roomKey]) {
                privateMessages[roomKey] = [];
            }
            privateMessages[roomKey].push(message);
            
            // Keep only last 50 messages per private chat
            if (privateMessages[roomKey].length > 50) privateMessages[roomKey].shift();
            
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('private-message', message);
                socket.emit('private-message', { ...message, sent: true });
            } else {
                socket.emit('private-message', { ...message, sent: true, offline: true });
            }
            console.log(`🔒 [PRIVATE] ${fromUsername} -> ${to}: ${message.text || message.type || 'message'}`);
        });
    });
    
    // Get private message history
    socket.on('get-private-history', (otherUsername) => {
        const currentUsername = users[socket.id];
        if (!currentUsername) return;
        
        db.getPrivateMessages(currentUsername, otherUsername, (dbMessages) => {
            const roomKey = getPrivateRoomKey(currentUsername, otherUsername);
            privateMessages[roomKey] = dbMessages;
            socket.emit('private-history', { otherUsername, messages: dbMessages });
        });
    });
    
    // Add reaction to message
    socket.on('add-reaction', ({ messageId, reaction, chatType, otherUser }) => {
        const username = users[socket.id];
        if (!username) return;
        
        if (chatType === 'group') {
            // Find message in group messages
            const message = messages.find(m => m.id == messageId);
            if (message) {
                if (!message.reactions) message.reactions = {};
                if (!message.reactions[reaction]) message.reactions[reaction] = [];
                if (!message.reactions[reaction].includes(username)) {
                    message.reactions[reaction].push(username);
                    io.emit('message-reaction', { messageId, reaction, username });
                    
                    // Update in database
                    db.saveGroupMessage(message, () => {});
                }
            }
        } else if (chatType === 'private' && otherUser) {
            // Handle private message reactions
            const currentUsername = users[socket.id];
            const roomKey = getPrivateRoomKey(currentUsername, otherUser);
            const messagesList = privateMessages[roomKey] || [];
            const message = messagesList.find(m => m.id == messageId);
            
            if (message) {
                if (!message.reactions) message.reactions = {};
                if (!message.reactions[reaction]) message.reactions[reaction] = [];
                if (!message.reactions[reaction].includes(username)) {
                    message.reactions[reaction].push(username);
                    
                    // Send to both users
                    const recipientSocketId = Object.keys(users).find(id => users[id] === otherUser);
                    if (recipientSocketId) {
                        io.to(recipientSocketId).emit('message-reaction', { messageId, reaction, username });
                    }
                    socket.emit('message-reaction', { messageId, reaction, username });
                    
                    // Update in database
                    db.savePrivateMessage(message, () => {});
                }
            }
        }
    });
    
    // Typing indicators
    socket.on('typing', () => {
        const username = users[socket.id];
        if (username) {
            socket.broadcast.emit('user-typing', { username: username });
        }
    });
    
    socket.on('private-typing', ({ to }) => {
        const fromUsername = users[socket.id];
        if (!fromUsername) return;
        
        const recipientSocketId = Object.keys(users).find(id => users[id] === to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('private-typing-indicator', { from: fromUsername });
        }
    });
    
    // Disconnect
    socket.on('disconnect', () => {
        const username = users[socket.id];
        
        if (username) {
            delete users[socket.id];
            updateOnlineUsers();
            io.emit('user-left', `${username} left the chat`);
            console.log(`👋 ${username} disconnected`);
            console.log('👥 Active users:', Object.values(users));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Open http://localhost:${PORT} in your browser`);
});