const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'chat.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS group_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            text TEXT,
            image_url TEXT,
            file_url TEXT,
            file_name TEXT,
            file_type TEXT,
            file_size INTEGER,
            voice_url TEXT,
            voice_duration INTEGER,
            message_type TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS private_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_user TEXT NOT NULL,
            to_user TEXT NOT NULL,
            text TEXT,
            image_url TEXT,
            file_url TEXT,
            file_name TEXT,
            file_type TEXT,
            file_size INTEGER,
            voice_url TEXT,
            voice_duration INTEGER,
            message_type TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    console.log('✅ Database initialized!');
});

function saveGroupMessage(message, callback) {
    const sql = `
        INSERT INTO group_messages (username, text, image_url, file_url, file_name, file_type, file_size, voice_url, voice_duration, message_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    db.run(sql, [
        message.username,
        message.text || null,
        message.imageUrl || null,
        message.fileUrl || null,
        message.fileName || null,
        message.fileType || null,
        message.fileSize || null,
        message.voiceUrl || null,
        message.duration || null,
        message.type
    ], function(err) {
        if (err) {
            console.error('❌ Error saving group message:', err);
        } else {
            message.id = this.lastID;
            if (callback) callback(message);
        }
    });
}

function getRecentGroupMessages(callback) {
    const sql = `SELECT * FROM group_messages ORDER BY timestamp DESC LIMIT 100`;
    
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('❌ Error loading group messages:', err);
            callback([]);
        } else {
            const messages = rows.reverse().map(row => ({
                id: row.id,
                username: row.username,
                text: row.text,
                imageUrl: row.image_url,
                fileUrl: row.file_url,
                fileName: row.file_name,
                fileType: row.file_type,
                fileSize: row.file_size,
                voiceUrl: row.voice_url,
                duration: row.voice_duration,
                type: row.message_type,
                reactions: {},
                timestamp: new Date(row.timestamp).toLocaleTimeString()
            }));
            callback(messages);
        }
    });
}

function savePrivateMessage(message, callback) {
    const sql = `
        INSERT INTO private_messages (from_user, to_user, text, image_url, file_url, file_name, file_type, file_size, voice_url, voice_duration, message_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    db.run(sql, [
        message.from,
        message.to,
        message.text || null,
        message.imageUrl || null,
        message.fileUrl || null,
        message.fileName || null,
        message.fileType || null,
        message.fileSize || null,
        message.voiceUrl || null,
        message.duration || null,
        message.type
    ], function(err) {
        if (err) {
            console.error('❌ Error saving private message:', err);
        } else {
            message.id = this.lastID;
            if (callback) callback(message);
        }
    });
}

function getPrivateMessages(user1, user2, callback) {
    const sql = `
        SELECT * FROM private_messages 
        WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)
        ORDER BY timestamp ASC LIMIT 100
    `;
    
    db.all(sql, [user1, user2, user2, user1], (err, rows) => {
        if (err) {
            console.error('❌ Error loading private messages:', err);
            callback([]);
        } else {
            const messages = rows.map(row => ({
                id: row.id,
                from: row.from_user,
                to: row.to_user,
                text: row.text,
                imageUrl: row.image_url,
                fileUrl: row.file_url,
                fileName: row.file_name,
                fileType: row.file_type,
                fileSize: row.file_size,
                voiceUrl: row.voice_url,
                duration: row.voice_duration,
                type: row.message_type,
                reactions: {},
                timestamp: new Date(row.timestamp).toLocaleTimeString()
            }));
            callback(messages);
        }
    });
}

module.exports = {
    saveGroupMessage,
    getRecentGroupMessages,
    savePrivateMessage,
    getPrivateMessages
};