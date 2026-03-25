const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads folder
const uploadsDir = path.join(__dirname, 'uploads');
const avatarsDir = path.join(__dirname, 'uploads/avatars');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir);

// Configure multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'avatar') cb(null, 'uploads/avatars/');
        else cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
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
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ success: true, avatarUrl: `/uploads/avatars/${req.file.filename}` });
});

// Store data
let users = {};
let messages = [];
let privateMessages = {};
let userAvatars = {};

function getPrivateRoomKey(user1, user2) {
    return [user1, user2].sort().join('_');
}

io.on('connection', (socket) => {
    console.log('🔌 User connected:', socket.id);
    
    socket.on('set-username', (username) => {
        if (Object.values(users).some(u => u === username)) {
            socket.emit('username-taken');
            return;
        }
        users[socket.id] = username;
        socket.username = username;
        
        if (userAvatars[username]) {
            socket.emit('avatar-update', { username, avatarUrl: userAvatars[username] });
        }
        
        socket.emit('previous-messages', messages);
        io.emit('online-users', Object.values(users));
        io.emit('user-joined', `${username} joined the chat`);
        console.log(`✅ ${username} joined`);
    });
    
    socket.on('update-avatar', ({ username, avatarUrl }) => {
        userAvatars[username] = avatarUrl;
        io.emit('avatar-update', { username, avatarUrl });
    });
    
    // Group messages
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
        
        if (data.replyTo) message.replyTo = data.replyTo;
        if (data.type === 'image') message.imageUrl = data.imageUrl;
        if (data.type === 'file') {
            message.fileUrl = data.fileUrl;
            message.fileName = data.fileName;
            message.fileSize = data.fileSize;
        }
        if (data.type === 'voice') {
            message.voiceUrl = data.voiceUrl;
            message.duration = data.duration;
        }
        if (data.type === 'gif') message.gifUrl = data.gifUrl;
        if (data.type === 'poll') {
            message.question = data.question;
            message.options = data.options;
            message.votes = data.votes;
        }
        if (data.type === 'location') {
            message.lat = data.lat;
            message.lng = data.lng;
            message.mapUrl = data.mapUrl;
        }
        
        messages.push(message);
        if (messages.length > 100) messages.shift();
        
        io.emit('new-message', message);
        console.log(`💬 ${username}: ${data.text || data.type}`);
        
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
        
        if (data.replyTo) message.replyTo = data.replyTo;
        if (data.type === 'image') message.imageUrl = data.imageUrl;
        if (data.type === 'file') {
            message.fileUrl = data.fileUrl;
            message.fileName = data.fileName;
            message.fileSize = data.fileSize;
        }
        if (data.type === 'voice') {
            message.voiceUrl = data.voiceUrl;
            message.duration = data.duration;
        }
        if (data.type === 'gif') message.gifUrl = data.gifUrl;
        if (data.type === 'poll') {
            message.question = data.question;
            message.options = data.options;
            message.votes = data.votes;
        }
        if (data.type === 'location') {
            message.lat = data.lat;
            message.lng = data.lng;
            message.mapUrl = data.mapUrl;
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
        console.log(`🔒 ${fromUser} -> ${data.to}: ${data.text || data.type}`);
    });
    
    socket.on('get-private-history', (otherUser) => {
        const currentUser = users[socket.id];
        if (!currentUser) return;
        const key = getPrivateRoomKey(currentUser, otherUser);
        socket.emit('private-history', { otherUsername: otherUser, messages: privateMessages[key] || [] });
    });
    
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
                    if (senderId) io.to(senderId).emit('message-read', { messageId, reader: username });
                }
            }
        }
    });
    
    socket.on('edit-message', ({ messageId, newText, chatType, otherUser }) => {
        const username = users[socket.id];
        if (!username) return;
        
        if (chatType === 'group') {
            const message = messages.find(m => m.id == messageId);
            if (message && message.username === username) {
                message.text = newText;
                message.edited = true;
                io.emit('message-edited', { messageId, newText, chatType });
            }
        } else if (chatType === 'private' && otherUser) {
            const key = getPrivateRoomKey(username, otherUser);
            const message = (privateMessages[key] || []).find(m => m.id == messageId);
            if (message && message.from === username) {
                message.text = newText;
                message.edited = true;
                const recipientId = Object.keys(users).find(id => users[id] === otherUser);
                if (recipientId) io.to(recipientId).emit('message-edited', { messageId, newText, chatType });
                socket.emit('message-edited', { messageId, newText, chatType });
            }
        }
    });
    
    socket.on('delete-message', ({ messageId, chatType, otherUser }) => {
        const username = users[socket.id];
        if (!username) return;
        
        if (chatType === 'group') {
            const index = messages.findIndex(m => m.id == messageId);
            if (index !== -1 && messages[index].username === username) {
                messages.splice(index, 1);
                io.emit('message-deleted', { messageId, chatType });
            }
        } else if (chatType === 'private' && otherUser) {
            const key = getPrivateRoomKey(username, otherUser);
            const index = (privateMessages[key] || []).findIndex(m => m.id == messageId);
            if (index !== -1 && privateMessages[key][index].from === username) {
                privateMessages[key].splice(index, 1);
                const recipientId = Object.keys(users).find(id => users[id] === otherUser);
                if (recipientId) io.to(recipientId).emit('message-deleted', { messageId, chatType });
                socket.emit('message-deleted', { messageId, chatType });
            }
        }
    });
    
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
                    if (recipientId) io.to(recipientId).emit('message-reaction', { messageId, reaction, username });
                    socket.emit('message-reaction', { messageId, reaction, username });
                }
            }
        }
    });
    
    socket.on('forward-message', ({ messageId, to, originalMessage }) => {
        const fromUser = users[socket.id];
        if (!fromUser) return;
        
        const forwardedMessage = {
            ...originalMessage,
            id: Date.now(),
            forwarded: true,
            forwardedFrom: fromUser,
            timestamp: new Date().toLocaleTimeString()
        };
        
        const key = getPrivateRoomKey(fromUser, to);
        if (!privateMessages[key]) privateMessages[key] = [];
        privateMessages[key].push(forwardedMessage);
        if (privateMessages[key].length > 50) privateMessages[key].shift();
        
        const toSocketId = Object.keys(users).find(id => users[id] === to);
        if (toSocketId) {
            io.to(toSocketId).emit('private-message', forwardedMessage);
        }
        socket.emit('private-message', forwardedMessage);
    });
    
    socket.on('vote-poll', ({ pollId, optionIndex, chatType, otherUser }) => {
        const username = users[socket.id];
        if (!username) return;
        
        if (chatType === 'group') {
            const message = messages.find(m => m.id == pollId);
            if (message && message.type === 'poll') {
                if (!message.votes) message.votes = {};
                message.votes[username] = optionIndex;
                io.emit('vote-poll', { pollId, optionIndex, voter: username });
            }
        } else if (chatType === 'private' && otherUser) {
            const key = getPrivateRoomKey(username, otherUser);
            const message = (privateMessages[key] || []).find(m => m.id == pollId);
            if (message && message.type === 'poll') {
                if (!message.votes) message.votes = {};
                message.votes[username] = optionIndex;
                const recipientId = Object.keys(users).find(id => users[id] === otherUser);
                if (recipientId) io.to(recipientId).emit('vote-poll', { pollId, optionIndex, voter: username });
                socket.emit('vote-poll', { pollId, optionIndex, voter: username });
            }
        }
    });
    
    socket.on('typing', () => {
        const username = users[socket.id];
        if (username) socket.broadcast.emit('user-typing', { username });
    });
    
    socket.on('private-typing', ({ to }) => {
        const fromUser = users[socket.id];
        if (!fromUser) return;
        const toSocketId = Object.keys(users).find(id => users[id] === to);
        if (toSocketId) io.to(toSocketId).emit('private-typing-indicator', { from: fromUser });
    });
    
    socket.on('disconnect', () => {
        const username = users[socket.id];
        if (username) {
            delete users[socket.id];
            io.emit('online-users', Object.values(users));
            io.emit('user-left', `${username} left the chat`);
            console.log(`👋 ${username} disconnected`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});