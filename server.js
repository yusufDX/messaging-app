const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads folder
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Configure multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

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

// Store data
let users = {};
let messages = [];
let privateMessages = {};

function getPrivateKey(user1, user2) {
    return [user1, user2].sort().join('_');
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('set-username', (username) => {
        const taken = Object.values(users).some(u => u === username);
        if (taken) {
            socket.emit('username-taken');
            return;
        }
        
        users[socket.id] = username;
        socket.username = username;
        
        socket.emit('previous-messages', messages);
        io.emit('online-users', Object.values(users));
        io.emit('user-joined', `${username} joined the chat`);
        
        console.log(`${username} joined`);
    });
    
    socket.on('send-message', (data) => {
        const username = users[socket.id];
        if (!username) return;
        
        const message = {
            id: Date.now(),
            username: username,
            text: data.text,
            type: data.type || 'text',
            timestamp: new Date().toLocaleTimeString()
        };
        
        if (data.type === 'image') {
            message.imageUrl = data.imageUrl;
        } else if (data.type === 'file') {
            message.fileUrl = data.fileUrl;
            message.fileName = data.fileName;
            message.fileSize = data.fileSize;
        }
        
        messages.push(message);
        if (messages.length > 100) messages.shift();
        
        io.emit('new-message', message);
        console.log(`${username}: ${data.text || data.type}`);
    });
    
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
            timestamp: new Date().toLocaleTimeString()
        };
        
        if (data.type === 'image') {
            message.imageUrl = data.imageUrl;
        } else if (data.type === 'file') {
            message.fileUrl = data.fileUrl;
            message.fileName = data.fileName;
            message.fileSize = data.fileSize;
        }
        
        const key = getPrivateKey(fromUser, data.to);
        if (!privateMessages[key]) privateMessages[key] = [];
        privateMessages[key].push(message);
        if (privateMessages[key].length > 50) privateMessages[key].shift();
        
        if (toSocketId) {
            io.to(toSocketId).emit('private-message', message);
        }
        socket.emit('private-message', message);
        
        console.log(`Private: ${fromUser} -> ${data.to}: ${data.text || data.type}`);
    });
    
    socket.on('get-private-history', (otherUser) => {
        const currentUser = users[socket.id];
        if (!currentUser) return;
        
        const key = getPrivateKey(currentUser, otherUser);
        const history = privateMessages[key] || [];
        socket.emit('private-history', { otherUsername: otherUser, messages: history });
    });
    
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
    
    socket.on('disconnect', () => {
        const username = users[socket.id];
        if (username) {
            delete users[socket.id];
            io.emit('online-users', Object.values(users));
            io.emit('user-left', `${username} left the chat`);
            console.log(`${username} disconnected`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});