import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = path.join(__dirname, 'auth.db');
const INIT_SQL_PATH = path.join(__dirname, 'init.sql');

// Create database connection
const db = new Database(DB_PATH);
console.log('Connected to SQLite database');

// Initialize database with schema
const initializeDatabase = async () => {
  try {
    const initSQL = fs.readFileSync(INIT_SQL_PATH, 'utf8');
    db.exec(initSQL);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error.message);
    throw error;
  }
};

// User database operations
const userDb = {
  // Check if any users exist
  hasUsers: () => {
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM users').get();
      return row.count > 0;
    } catch (err) {
      throw err;
    }
  },

  // Create a new user
  createUser: (username, passwordHash) => {
    try {
      const stmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
      const result = stmt.run(username, passwordHash);
      return { id: result.lastInsertRowid, username };
    } catch (err) {
      throw err;
    }
  },

  // Get user by username
  getUserByUsername: (username) => {
    try {
      const row = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
      return row;
    } catch (err) {
      throw err;
    }
  },

  // Update last login time
  updateLastLogin: (userId) => {
    try {
      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
    } catch (err) {
      throw err;
    }
  },

  // Get user by ID
  getUserById: (userId) => {
    try {
      const row = db.prepare('SELECT id, username, created_at, last_login FROM users WHERE id = ? AND is_active = 1').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  }
};

// Job queue database operations
const jobDb = {
  // Add a new job to the queue
  addJob: (projectName, sessionId, command, options, userId, priority = 0) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO jobs (project_name, session_id, command, options, user_id, priority)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(projectName, sessionId, command, JSON.stringify(options), userId, priority);
      return { id: result.lastInsertRowid };
    } catch (err) {
      throw err;
    }
  },

  // Get next pending job for a specific project (respects session ordering)
  getNextJobForProject: (projectName) => {
    try {
      // First, check if there are any running jobs in the same session
      const runningInSessionStmt = db.prepare(`
        SELECT j1.session_id 
        FROM jobs j1 
        WHERE j1.project_name = ? 
        AND j1.status = 'running' 
        AND j1.session_id IS NOT NULL
      `);
      const runningSessions = runningInSessionStmt.all(projectName).map(row => row.session_id);

      let query;
      let params = [projectName];

      if (runningSessions.length > 0) {
        // If there are running jobs in sessions, only get jobs from different sessions or no session
        const placeholders = runningSessions.map(() => '?').join(',');
        query = `
          SELECT * FROM jobs 
          WHERE project_name = ? 
          AND status IN ('pending', 'failed') 
          AND (session_id IS NULL OR session_id NOT IN (${placeholders}))
          ORDER BY 
            CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
            priority DESC, 
            created_at ASC 
          LIMIT 1
        `;
        params = params.concat(runningSessions);
      } else {
        // No running jobs in any session, get the next pending or failed job (retry)
        query = `
          SELECT * FROM jobs 
          WHERE project_name = ? 
          AND status IN ('pending', 'failed') 
          ORDER BY 
            CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
            priority DESC, 
            created_at ASC 
          LIMIT 1
        `;
      }

      const row = db.prepare(query).get(...params);
      return row ? {
        ...row,
        options: JSON.parse(row.options)
      } : null;
    } catch (err) {
      throw err;
    }
  },

  // Update job status
  updateJobStatus: (jobId, status, errorMessage = null) => {
    try {
      const now = new Date().toISOString();
      const updates = ['status = ?'];
      const params = [status];

      if (status === 'running') {
        updates.push('started_at = ?');
        params.push(now);
      } else if (status === 'completed' || status === 'failed') {
        updates.push('completed_at = ?');
        params.push(now);
      }

      if (errorMessage) {
        updates.push('error_message = ?');
        params.push(errorMessage);
      }

      params.push(jobId);

      const stmt = db.prepare(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`);
      stmt.run(...params);
    } catch (err) {
      throw err;
    }
  },

  // Get all active jobs (pending or running) for status display
  getActiveJobs: () => {
    try {
      const rows = db.prepare(`
        SELECT * FROM jobs 
        WHERE status IN ('pending', 'running') 
        ORDER BY project_name, priority DESC, created_at ASC
      `).all();
      
      return rows.map(row => ({
        ...row,
        options: JSON.parse(row.options)
      }));
    } catch (err) {
      throw err;
    }
  },

  // Get jobs for a specific project
  getJobsForProject: (projectName, limit = 20) => {
    try {
      const rows = db.prepare(`
        SELECT * FROM jobs 
        WHERE project_name = ? 
        ORDER BY created_at DESC 
        LIMIT ?
      `).all(projectName, limit);
      
      return rows.map(row => ({
        ...row,
        options: JSON.parse(row.options)
      }));
    } catch (err) {
      throw err;
    }
  },

  // Clean up old completed jobs (keep last 100 per project)
  cleanupOldJobs: (projectName = null) => {
    try {
      if (projectName) {
        // Clean specific project
        const stmt = db.prepare(`
          DELETE FROM jobs 
          WHERE project_name = ? 
          AND status IN ('completed', 'failed')
          AND id NOT IN (
            SELECT id FROM jobs 
            WHERE project_name = ? 
            AND status IN ('completed', 'failed')
            ORDER BY completed_at DESC 
            LIMIT 100
          )
        `);
        stmt.run(projectName, projectName);
      } else {
        // Clean all projects
        const projects = db.prepare('SELECT DISTINCT project_name FROM jobs').all();
        for (const { project_name } of projects) {
          const stmt = db.prepare(`
            DELETE FROM jobs 
            WHERE project_name = ? 
            AND status IN ('completed', 'failed')
            AND id NOT IN (
              SELECT id FROM jobs 
              WHERE project_name = ? 
              AND status IN ('completed', 'failed')
              ORDER BY completed_at DESC 
              LIMIT 100
            )
          `);
          stmt.run(project_name, project_name);
        }
      }
    } catch (err) {
      throw err;
    }
  }
};

export {
  db,
  initializeDatabase,
  userDb,
  jobDb
};