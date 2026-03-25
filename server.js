const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./database'); // Import our database functions

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

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
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
        db.getRecentGroupMessages((messages) => {
            socket.emit('previous-messages', messages);
        });
        
        updateOnlineUsers();
        io.emit('user-joined', `${username} joined the chat`);
        
        console.log(`${username} joined the chat`);
        console.log('Active users:', Object.values(users));
    });
    
    function updateOnlineUsers() {
        const onlineUsers = Object.values(users);
        io.emit('online-users', onlineUsers);
    }
    
    // Group chat messages (text and files)
    socket.on('send-message', (messageData) => {
        const username = users[socket.id];
        if (!username) return;
        
        const message = {
            username: username,
            timestamp: new Date().toLocaleTimeString(),
            type: messageData.type || 'text'
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
        } else {
            message.text = messageData.text;
        }
        
        // Save to database
        db.saveGroupMessage(message, (savedMessage) => {
            // Broadcast to all users
            io.emit('new-message', message);
            console.log(`[GROUP] ${username}: ${message.text || 'file'}`);
        });
    });
    
    // Private messages with files
    socket.on('send-private-message', ({ to, text, type, imageUrl, fileUrl, fileName, fileType, fileSize }) => {
        const fromUsername = users[socket.id];
        if (!fromUsername) return;
        
        const recipientSocketId = Object.keys(users).find(id => users[id] === to);
        
        const message = {
            from: fromUsername,
            to: to,
            timestamp: new Date().toLocaleTimeString(),
            type: type || 'text'
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
        } else {
            message.text = text;
        }
        
        // Save to database
        db.savePrivateMessage(message, () => {
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('private-message', message);
                socket.emit('private-message', { ...message, sent: true });
            } else {
                // User offline - still saved but no real-time delivery
                socket.emit('private-message', { ...message, sent: true, offline: true });
            }
            console.log(`[PRIVATE] ${fromUsername} -> ${to}: ${message.text || 'file'}`);
        });
    });
    
    // Get private message history
    socket.on('get-private-history', (otherUsername) => {
        const currentUsername = users[socket.id];
        if (!currentUsername) return;
        
        db.getPrivateMessages(currentUsername, otherUsername, (messages) => {
            socket.emit('private-history', { otherUsername, messages });
        });
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
            console.log(`${username} disconnected`);
            console.log('Active users:', Object.values(users));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});