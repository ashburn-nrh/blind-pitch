/* SQLite storage. One file, created on first run. */
import Database from 'better-sqlite3';

export function openDb(path) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, pass_salt TEXT NOT NULL,
      dob TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS profiles (
      user_id INTEGER PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS queue (
      user_id INTEGER PRIMARY KEY, joined_at INTEGER NOT NULL, seen_at INTEGER NOT NULL);
    -- A match is one game between two people. kind: 'queue' (strangers) or 'private' (room code).
    -- status: playing -> mutual (both said yes) | declined | ended (left, unmatched or blocked).
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'playing',
      host_id INTEGER NOT NULL, guest_id INTEGER, host_presence TEXT, guest_presence TEXT,
      chem INTEGER, starters TEXT, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS matches_host ON matches(host_id);
    CREATE INDEX IF NOT EXISTS matches_guest ON matches(guest_id);
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY, match_id INTEGER NOT NULL, sender_id INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_match ON messages(match_id, id);
    CREATE TABLE IF NOT EXISTS blocks (
      blocker_id INTEGER NOT NULL, blocked_id INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (blocker_id, blocked_id));
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY, reporter_id INTEGER NOT NULL, reported_id INTEGER NOT NULL, match_id INTEGER NOT NULL,
      reason TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
  `);
  return db;
}
