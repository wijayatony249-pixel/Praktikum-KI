const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'zerotrust.db');
const db = new Database(dbPath);

// Aktifkan foreign keys di SQLite
db.pragma('foreign_keys = ON');

module.exports = db;

