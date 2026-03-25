const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'chat.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Table for group messages
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
            reply_to_id INTEGER,
            reply_to_text TEXT,
            reply_to_username TEXT,
            forwarded BOOLEAN DEFAULT 0,
            forwarded_from TEXT,
            edited BOOLEAN DEFAULT 0,
            read_by TEXT,
            message_type TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Table for private messages
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
            reply_to_id INTEGER,
            reply_to_text TEXT,
            reply_to_username TEXT,
            forwarded BOOLEAN DEFAULT 0,
            forwarded_from TEXT,
            edited BOOLEAN DEFAULT 0,
            read_by TEXT,
            message_type TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Table for user avatars
    db.run(`
        CREATE TABLE IF NOT EXISTS user_avatars (
            username TEXT PRIMARY KEY,
            avatar_url TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    console.log('✅ Database initialized!');
});

// Save group message
function saveGroupMessage(message, callback) {
    const sql = `
        INSERT INTO group_messages (
            username, text, image_url, file_url, file_name, file_type, file_size,
            voice_url, voice_duration, reply_to_id, reply_to_text, reply_to_username,
            forwarded, forwarded_from, edited, read_by, message_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        message.replyTo?.id || null,
        message.replyTo?.text || null,
        message.replyTo?.username || null,
        message.forwarded ? 1 : 0,
        message.forwardedFrom || null,
        message.edited ? 1 : 0,
        message.readBy ? JSON.stringify(message.readBy) : null,
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

// Get recent group messages (last 100)
function getRecentGroupMessages(callback) {
    const sql = `
        SELECT * FROM group_messages 
        ORDER BY timestamp DESC LIMIT 100
    `;
    
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
                replyTo: row.reply_to_id ? {
                    id: row.reply_to_id,
                    text: row.reply_to_text,
                    username: row.reply_to_username
                } : null,
                forwarded: row.forwarded === 1,
                forwardedFrom: row.forwarded_from,
                edited: row.edited === 1,
                readBy: row.read_by ? JSON.parse(row.read_by) : [],
                reactions: {},
                timestamp: new Date(row.timestamp).toLocaleTimeString()
            }));
            callback(messages);
        }
    });
}

// Save private message
function savePrivateMessage(message, callback) {
    const sql = `
        INSERT INTO private_messages (
            from_user, to_user, text, image_url, file_url, file_name, file_type, file_size,
            voice_url, voice_duration, reply_to_id, reply_to_text, reply_to_username,
            forwarded, forwarded_from, edited, read_by, message_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        message.replyTo?.id || null,
        message.replyTo?.text || null,
        message.replyTo?.username || null,
        message.forwarded ? 1 : 0,
        message.forwardedFrom || null,
        message.edited ? 1 : 0,
        message.readBy ? JSON.stringify(message.readBy) : null,
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

// Get private message history between two users
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
                replyTo: row.reply_to_id ? {
                    id: row.reply_to_id,
                    text: row.reply_to_text,
                    username: row.reply_to_username
                } : null,
                forwarded: row.forwarded === 1,
                forwardedFrom: row.forwarded_from,
                edited: row.edited === 1,
                readBy: row.read_by ? JSON.parse(row.read_by) : [],
                reactions: {},
                timestamp: new Date(row.timestamp).toLocaleTimeString()
            }));
            callback(messages);
        }
    });
}

// Save or update user avatar
function saveUserAvatar(username, avatarUrl, callback) {
    const sql = `
        INSERT INTO user_avatars (username, avatar_url)
        VALUES (?, ?)
        ON CONFLICT(username) DO UPDATE SET
        avatar_url = excluded.avatar_url,
        updated_at = CURRENT_TIMESTAMP
    `;
    
    db.run(sql, [username, avatarUrl], function(err) {
        if (err) {
            console.error('❌ Error saving avatar:', err);
        } else if (callback) {
            callback();
        }
    });
}

// Get user avatar
function getUserAvatar(username, callback) {
    const sql = `SELECT avatar_url FROM user_avatars WHERE username = ?`;
    
    db.get(sql, [username], (err, row) => {
        if (err) {
            console.error('❌ Error loading avatar:', err);
            callback(null);
        } else {
            callback(row ? row.avatar_url : null);
        }
    });
}

module.exports = {
    saveGroupMessage,
    getRecentGroupMessages,
    savePrivateMessage,
    getPrivateMessages,
    saveUserAvatar,
    getUserAvatar
};