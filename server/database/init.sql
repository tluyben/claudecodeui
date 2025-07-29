-- Initialize authentication database
PRAGMA foreign_keys = ON;

-- Users table (single user system)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_active BOOLEAN DEFAULT 1
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- Job queue table for background Claude CLI processing
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL,
    session_id TEXT,
    command TEXT NOT NULL,
    options TEXT NOT NULL, -- JSON string of spawnClaude options
    status TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed
    priority INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    error_message TEXT,
    user_id INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes for job queue performance
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_name);
CREATE INDEX IF NOT EXISTS idx_jobs_session ON jobs(session_id);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority DESC, created_at ASC);