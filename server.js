const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads folder if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
const avatarsDir = path.join(__dirname, 'uploads/avatars');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir);

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'avatar') {
            cb(null, 'uploads/avatars/');
        } else {
            cb(null, 'uploads/');
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Create app and server
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    res.json({
        success: true,
        fileUrl: `/uploads/${req.file.filename}`,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        fileSize: req.file.size
    });
});

// Avatar upload endpoint
app.post('/upload-avatar', upload.single('avatar'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    res.json({
        success: true,
        avatarUrl: `/uploads/avatars/${req.file.filename}`
    });
});

// Store data
let users = {};
let messages = [];
let privateMessages = {};
let userAvatars = {};

// Helper function for private message room keys
function getPrivateRoomKey(user1, user2) {
    return [user1, user2].sort().join('_');
}

io.on('connection', (socket) => {
    console.log('🔌 User connected:', socket.id);
    
    // User sets their username
    socket.on('set-username', (username) => {
        if (Object.values(users).some(u => u === username)) {
            socket.emit('username-taken');
            return;
        }
        
        users[socket.id] = username;
        socket.username = username;
        
        // Load user avatar
        if (userAvatars[username]) {
            socket.emit('avatar-update', { username, avatarUrl: userAvatars[username] });
        }
        
        // Send existing messages
        socket.emit('previous-messages', messages);
        
        // Update online users list
        io.emit('online-users', Object.values(users));
        io.emit('user-joined', `${username} joined the chat`);
        
        console.log(`✅ ${username} joined`);
        console.log('👥 Active users:', Object.values(users));
    });
    
    // Avatar update
    socket.on('update-avatar', ({ username, avatarUrl }) => {
        userAvatars[username] = avatarUrl;
        io.emit('avatar-update', { username, avatarUrl });
        console.log(`📸 ${username} updated avatar`);
    });
    
    // Group chat messages
    socket.on('send-message', (data) => {
        const username = users[socket.id];
        if (!username) return;
        
        const message = {
            id: Date.now(),
            username: username,
            text: data.text,
            type: data.type || 'text',
            timestamp: new Date().toLocaleTimeString(),
            reactions: {},
            edited: false,
            status: 'sent',
            readBy: []
        };
        
        // Handle reply
        if (data.replyTo) {
            message.replyTo = {
                id: data.replyTo.id,
                text: data.replyTo.text,
                username: data.replyTo.username
            };
        }
        
        // Handle different message types
        if (data.type === 'image') {
            message.imageUrl = data.imageUrl;
        } else if (data.type === 'file') {
            message.fileUrl = data.fileUrl;
            message.fileName = data.fileName;
            message.fileSize = data.fileSize;
        } else if (data.type === 'voice') {
            message.voiceUrl = data.voiceUrl;
            message.duration = data.duration;
        }
        
        messages.push(message);
        if (messages.length > 100) messages.shift();
        
        io.emit('new-message', message);
        console.log(`💬 [GROUP] ${username}: ${data.text || data.type}`);
        
        // Mark as delivered after short delay
        setTimeout(() => {
            message.status = 'delivered';
            io.emit('message-delivered', { messageId: message.id });
        }, 100);
    });
    
    // Private messages
    socket.on('send-private-message', (data) => {
        const fromUser = users[socket.id];
        if (!fromUser) return;
        
        const toSocketId = Object.keys(users).find(id => users[id] === data.to);
        
        const message = {
            id: Date.now(),
            from: fromUser,
            to: data.to,
            text: data.text,
            type: data.type || 'text',
            timestamp: new Date().toLocaleTimeString(),
            reactions: {},
            edited: false,
            status: 'sent',
            readBy: []
        };
        
        // Handle reply
        if (data.replyTo) {
            message.replyTo = {
                id: data.replyTo.id,
                text: data.replyTo.text,
                username: data.replyTo.username
            };
        }
        
        if (data.type === 'image') {
            message.imageUrl = data.imageUrl;
        } else if (data.type === 'file') {
            message.fileUrl = data.fileUrl;
            message.fileName = data.fileName;
            message.fileSize = data.fileSize;
        } else if (data.type === 'voice') {
            message.voiceUrl = data.voiceUrl;
            message.duration = data.duration;
        }
        
        const key = getPrivateRoomKey(fromUser, data.to);
        if (!privateMessages[key]) privateMessages[key] = [];
        privateMessages[key].push(message);
        if (privateMessages[key].length > 50) privateMessages[key].shift();
        
        if (toSocketId) {
            io.to(toSocketId).emit('private-message', message);
            message.status = 'delivered';
            socket.emit('message-delivered', { messageId: message.id });
        }
        socket.emit('private-message', message);
        
        console.log(`🔒 [PRIVATE] ${fromUser} -> ${data.to}: ${data.text || data.type}`);
    });
    
    // Get private message history
    socket.on('get-private-history', (otherUser) => {
        const currentUser = users[socket.id];
        if (!currentUser) return;
        
        const key = getPrivateRoomKey(currentUser, otherUser);
        const history = privateMessages[key] || [];
        socket.emit('private-history', { otherUsername: otherUser, messages: history });
    });
    
    // Mark message as read
    socket.on('mark-read', ({ messageId, chatType, otherUser }) => {
        const username = users[socket.id];
        if (!username) return;
        
        if (chatType === 'group') {
            const message = messages.find(m => m.id == messageId);
            if (message && message.username !== username) {
                if (!message.readBy) message.readBy = [];
                if (!message.readBy.includes(username)) {
                    message.readBy.push(username);
                    message.status = 'read';
                    io.emit('message-read', { messageId, reader: username });
                }
            }
        } else if (chatType === 'private' && otherUser) {
            const key = getPrivateRoomKey(username, otherUser);
            const message = (privateMessages[key] || []).find(m => m.id == messageId);
            if (message && message.from !== username) {
                if (!message.readBy) message.readBy = [];
                if (!message.readBy.includes(username)) {
                    message.readBy.push(username);
                    message.status = 'read';
                    const senderId = Object.keys(users).find(id => users[id] === message.from);
                    if (senderId) {
                        io.to(senderId).emit('message-read', { messageId, reader: username });
                    }
                }
            }
        }
    });
    
    // Edit message
    socket.on('edit-message', ({ messageId, newText, chatType, otherUser }) => {
        const username = users[socket.id];
        if (!username) return;
        
        if (chatType === 'group') {
            const message = messages.find(m => m.id == messageId);
            if (message && message.username === username) {
                message.text = newText;
                message.edited = true;
                io.emit('message-edited', { messageId, newText, chatType });
                console.log(`✏️ ${username} edited a message`);
            }
        } else if (chatType === 'private' && otherUser) {
            const key = getPrivateRoomKey(username, otherUser);
            const message = (privateMessages[key] || []).find(m => m.id == messageId);
            if (message && message.from === username) {
                message.text = newText;
                message.edited = true;
                
                const recipientId = Object.keys(users).find(id => users[id] === otherUser);
                if (recipientId) {
                    io.to(recipientId).emit('message-edited', { messageId, newText, chatType });
                }
                socket.emit('message-edited', { messageId, newText, chatType });
                console.log(`✏️ ${username} edited a private message`);
            }
        }
    });
    
    // Delete message
    socket.on('delete-message', ({ messageId, chatType, otherUser }) => {
        const username = users[socket.id];
        if (!username) return;
        
        if (chatType === 'group') {
            const index = messages.findIndex(m => m.id == messageId);
            if (index !== -1 && messages[index].username === username) {
                messages.splice(index, 1);
                io.emit('message-deleted', { messageId, chatType });
                console.log(`🗑️ ${username} deleted a message`);
            }
        } else if (chatType === 'private' && otherUser) {
            const key = getPrivateRoomKey(username, otherUser);
            const index = (privateMessages[key] || []).findIndex(m => m.id == messageId);
            if (index !== -1 && privateMessages[key][index].from === username) {
                privateMessages[key].splice(index, 1);
                
                const recipientId = Object.keys(users).find(id => users[id] === otherUser);
                if (recipientId) {
                    io.to(recipientId).emit('message-deleted', { messageId, chatType });
                }
                socket.emit('message-deleted', { messageId, chatType });
                console.log(`🗑️ ${username} deleted a private message`);
            }
        }
    });
    
    // Add reaction
    socket.on('add-reaction', ({ messageId, reaction, chatType, otherUser }) => {
        const username = users[socket.id];
        if (!username) return;
        
        if (chatType === 'group') {
            const message = messages.find(m => m.id == messageId);
            if (message) {
                if (!message.reactions) message.reactions = {};
                if (!message.reactions[reaction]) message.reactions[reaction] = [];
                if (!message.reactions[reaction].includes(username)) {
                    message.reactions[reaction].push(username);
                    io.emit('message-reaction', { messageId, reaction, username });
                    console.log(`👍 ${username} reacted with ${reaction}`);
                }
            }
        } else if (chatType === 'private' && otherUser) {
            const currentUser = users[socket.id];
            const key = getPrivateRoomKey(currentUser, otherUser);
            const message = (privateMessages[key] || []).find(m => m.id == messageId);
            if (message) {
                if (!message.reactions) message.reactions = {};
                if (!message.reactions[reaction]) message.reactions[reaction] = [];
                if (!message.reactions[reaction].includes(username)) {
                    message.reactions[reaction].push(username);
                    const recipientId = Object.keys(users).find(id => users[id] === otherUser);
                    if (recipientId) {
                        io.to(recipientId).emit('message-reaction', { messageId, reaction, username });
                    }
                    socket.emit('message-reaction', { messageId, reaction, username });
                    console.log(`👍 ${username} reacted to private message with ${reaction}`);
                }
            }
        }
    });
    
    // Forward message
    socket.on('forward-message', ({ messageId, to, chatType, originalMessage }) => {
        const fromUser = users[socket.id];
        if (!fromUser) return;
        
        const forwardedMessage = {
            ...originalMessage,
            id: Date.now(),
            forwarded: true,
            forwardedFrom: fromUser,
            timestamp: new Date().toLocaleTimeString()
        };
        
        if (chatType === 'group') {
            forwardedMessage.username = fromUser;
            messages.push(forwardedMessage);
            if (messages.length > 100) messages.shift();
            io.emit('new-message', forwardedMessage);
            console.log(`↪️ ${fromUser} forwarded a message to group`);
        } else {
            const key = getPrivateRoomKey(fromUser, to);
            if (!privateMessages[key]) privateMessages[key] = [];
            privateMessages[key].push(forwardedMessage);
            if (privateMessages[key].length > 50) privateMessages[key].shift();
            
            const toSocketId = Object.keys(users).find(id => users[id] === to);
            if (toSocketId) {
                io.to(toSocketId).emit('private-message', forwardedMessage);
            }
            socket.emit('private-message', forwardedMessage);
            console.log(`↪️ ${fromUser} forwarded a message to ${to}`);
        }
    });
    
    // Search messages
    socket.on('search-messages', ({ query, chatType }) => {
        const results = [];
        if (chatType === 'group') {
            messages.forEach(msg => {
                if (msg.text && msg.text.toLowerCase().includes(query.toLowerCase())) {
                    results.push(msg);
                }
            });
        } else {
            const currentUser = users[socket.id];
            const key = getPrivateRoomKey(currentUser, currentUser);
            (privateMessages[key] || []).forEach(msg => {
                if (msg.text && msg.text.toLowerCase().includes(query.toLowerCase())) {
                    results.push(msg);
                }
            });
        }
        socket.emit('search-results', results.slice(0, 20));
    });
    
    // Video Call Events
    socket.on('call-user', ({ to, offer, audioOnly }) => {
        const toSocketId = Object.keys(users).find(id => users[id] === to);
        if (toSocketId) {
            io.to(toSocketId).emit('incoming-call', {
                from: users[socket.id],
                offer: offer,
                audioOnly: audioOnly || false
            });
            console.log(`📞 ${users[socket.id]} calling ${to}`);
        } else {
            socket.emit('call-error', { message: 'User not online' });
        }
    });
    
    socket.on('accept-call', ({ to, answer }) => {
        const toSocketId = Object.keys(users).find(id => users[id] === to);
        if (toSocketId) {
            io.to(toSocketId).emit('call-accepted', { answer });
            console.log(`✅ Call accepted between ${users[toSocketId]} and ${to}`);
        }
    });
    
    socket.on('reject-call', ({ to }) => {
        const toSocketId = Object.keys(users).find(id => users[id] === to);
        if (toSocketId) {
            io.to(toSocketId).emit('call-rejected');
            console.log(`❌ Call rejected by ${users[socket.id]}`);
        }
    });
    
    socket.on('call-busy', ({ to }) => {
        const toSocketId = Object.keys(users).find(id => users[id] === to);
        if (toSocketId) {
            io.to(toSocketId).emit('call-busy');
            console.log(`📞 ${users[socket.id]} is busy`);
        }
    });
    
    socket.on('ice-candidate', ({ to, candidate }) => {
        const toSocketId = Object.keys(users).find(id => users[id] === to);
        if (toSocketId) {
            io.to(toSocketId).emit('ice-candidate', { candidate });
        }
    });
    
    socket.on('end-call', ({ to }) => {
        const toSocketId = Object.keys(users).find(id => users[id] === to);
        if (toSocketId) {
            io.to(toSocketId).emit('end-call');
            console.log(`📞 Call ended between ${users[socket.id]} and ${to}`);
        }
    });
    
    // Screen sharing
    socket.on('share-screen', ({ to, stream }) => {
        const toSocketId = Object.keys(users).find(id => users[id] === to);
        if (toSocketId) {
            io.to(toSocketId).emit('screen-shared', { from: users[socket.id], stream });
            console.log(`🖥️ ${users[socket.id]} started screen sharing`);
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
        const fromUser = users[socket.id];
        if (!fromUser) return;
        
        const toSocketId = Object.keys(users).find(id => users[id] === to);
        if (toSocketId) {
            io.to(toSocketId).emit('private-typing-indicator', { from: fromUser });
        }
    });
    
    // Disconnect
    socket.on('disconnect', () => {
        const username = users[socket.id];
        if (username) {
            delete users[socket.id];
            io.emit('online-users', Object.values(users));
            io.emit('user-left', `${username} left the chat`);
            console.log(`👋 ${username} disconnected`);
            console.log('👥 Active users:', Object.values(users));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📱 Open your browser and start chatting!`);
});