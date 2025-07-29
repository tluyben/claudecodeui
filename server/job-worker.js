import { EventEmitter } from 'events';
import { jobDb } from './database/db.js';
import { spawnClaude } from './claude-cli.js';

class JobWorker extends EventEmitter {
  constructor() {
    super();
    this.projectWorkers = new Map(); // Map of projectName -> worker state
    this.isShuttingDown = false;
    this.pollInterval = 1000; // Check for new jobs every second
    this.maxConcurrentProjects = 10; // Limit concurrent projects
  }

  start() {
    console.log('🚀 Starting job worker system...');
    
    // Recover any jobs that were marked as 'running' but aren't actually running
    this.recoverStuckJobs();
    
    this.startJobPolling();
    
    // Clean up old jobs periodically (every hour)
    this.cleanupInterval = setInterval(() => {
      try {
        jobDb.cleanupOldJobs();
        console.log('🧹 Cleaned up old completed jobs');
      } catch (error) {
        console.error('❌ Error cleaning up old jobs:', error);
      }
    }, 60 * 60 * 1000);

    // Recovery check every 5 minutes
    this.recoveryInterval = setInterval(() => {
      this.recoverStuckJobs();
    }, 5 * 60 * 1000);
  }

  recoverStuckJobs() {
    try {
      // Find jobs that have been 'running' for more than 30 minutes (likely stuck)
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      
      const stuckJobs = jobDb.getActiveJobs().filter(job => 
        job.status === 'running' && 
        new Date(job.started_at) < new Date(thirtyMinutesAgo)
      );

      if (stuckJobs.length > 0) {
        console.log(`🔧 Found ${stuckJobs.length} stuck jobs, marking as failed for retry`);
        
        for (const job of stuckJobs) {
          jobDb.updateJobStatus(job.id, 'failed', 'Job timeout - marked for recovery');
          console.log(`🔄 Recovered stuck job ${job.id} in project ${job.project_name}`);
        }
      }
    } catch (error) {
      console.error('❌ Error during job recovery:', error);
    }
  }

  stop() {
    console.log('🛑 Shutting down job worker system...');
    this.isShuttingDown = true;
    
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
    }

    // Wait for all workers to finish (with timeout)
    return Promise.all(
      Array.from(this.projectWorkers.values()).map(worker => 
        worker.currentPromise || Promise.resolve()
      )
    ).catch(error => {
      console.error('❌ Error during worker shutdown:', error);
    });
  }

  startJobPolling() {
    if (this.isShuttingDown) return;

    try {
      // Get all active jobs to see which projects need workers
      const activeJobs = jobDb.getActiveJobs();
      const projectsWithJobs = new Set(activeJobs.map(job => job.project_name));

      // Start workers for projects that have jobs but no active worker
      for (const projectName of projectsWithJobs) {
        if (!this.projectWorkers.has(projectName) && 
            this.projectWorkers.size < this.maxConcurrentProjects) {
          this.startProjectWorker(projectName);
        }
      }

      // Emit status update for connected clients
      this.emit('jobs-update', {
        activeJobs: activeJobs,
        workingProjects: Array.from(this.projectWorkers.keys())
      });

    } catch (error) {
      console.error('❌ Error in job polling:', error);
    }

    // Schedule next poll
    this.pollTimer = setTimeout(() => {
      this.startJobPolling();
    }, this.pollInterval);
  }

  startProjectWorker(projectName) {
    if (this.projectWorkers.has(projectName)) {
      return; // Worker already exists
    }

    console.log(`🔧 Starting worker for project: ${projectName}`);

    const worker = {
      projectName,
      isRunning: false,
      currentJobId: null,
      currentPromise: null
    };

    this.projectWorkers.set(projectName, worker);
    this.processProjectJobs(projectName);
  }

  async processProjectJobs(projectName) {
    const worker = this.projectWorkers.get(projectName);
    if (!worker || this.isShuttingDown) {
      return;
    }

    try {
      // Get next job for this project
      const job = jobDb.getNextJobForProject(projectName);
      
      if (!job) {
        // No more jobs for this project, remove worker
        console.log(`✅ No more jobs for project: ${projectName}`);
        this.projectWorkers.delete(projectName);
        this.emit('project-worker-stopped', projectName);
        return;
      }

      console.log(`⚡ Processing job ${job.id} for project: ${projectName}`);
      
      // Mark job as running
      jobDb.updateJobStatus(job.id, 'running');
      worker.isRunning = true;
      worker.currentJobId = job.id;

      // Emit job started event
      this.emit('job-started', {
        jobId: job.id,
        projectName: job.project_name,
        sessionId: job.session_id,
        command: job.command
      });

      // Process the job
      worker.currentPromise = this.executeJob(job);
      await worker.currentPromise;

      // Job completed successfully
      jobDb.updateJobStatus(job.id, 'completed');
      console.log(`✅ Job ${job.id} completed for project: ${projectName}`);

      this.emit('job-completed', {
        jobId: job.id,
        projectName: job.project_name,
        sessionId: job.session_id
      });

    } catch (error) {
      // Job failed
      const jobId = worker.currentJobId;
      if (jobId) {
        jobDb.updateJobStatus(jobId, 'failed', error.message);
        console.error(`❌ Job ${jobId} failed for project: ${projectName}:`, error.message);

        this.emit('job-failed', {
          jobId: jobId,
          projectName: projectName,
          error: error.message
        });
      }
    } finally {
      worker.isRunning = false;
      worker.currentJobId = null;
      worker.currentPromise = null;
    }

    // Continue processing more jobs for this project
    if (!this.isShuttingDown) {
      setImmediate(() => this.processProjectJobs(projectName));
    }
  }

  async executeJob(job) {
    return new Promise((resolve, reject) => {
      // Create a mock WebSocket that collects output but doesn't send anywhere
      const mockWs = {
        send: (data) => {
          try {
            const parsed = JSON.parse(data);
            
            // Broadcast real-time updates to all connected clients
            this.emit('job-output', {
              jobId: job.id,
              projectName: job.project_name,
              sessionId: job.session_id,
              output: parsed
            });
          } catch (e) {
            // Ignore malformed messages
          }
        },
        readyState: 1, // WebSocket.OPEN
        OPEN: 1
      };

      // Execute the Claude CLI command
      spawnClaude(job.command, job.options, mockWs)
        .then(() => {
          resolve();
        })
        .catch((error) => {
          reject(error);
        });
    });
  }

  // Add a new job to the queue
  addJob(projectName, sessionId, command, options, userId, priority = 0) {
    try {
      const result = jobDb.addJob(projectName, sessionId, command, options, userId, priority);
      console.log(`📋 Added job ${result.id} to queue for project: ${projectName}`);
      
      this.emit('job-queued', {
        jobId: result.id,
        projectName,
        sessionId,
        command: command ? command.substring(0, 100) + '...' : '[Continue/Resume]'
      });

      // Start a worker for this project if needed
      if (!this.projectWorkers.has(projectName) && 
          this.projectWorkers.size < this.maxConcurrentProjects) {
        setImmediate(() => this.startProjectWorker(projectName));
      }

      return result;
    } catch (error) {
      console.error('❌ Error adding job to queue:', error);
      throw error;
    }
  }

  // Get status of all active jobs
  getJobStatus() {
    try {
      const activeJobs = jobDb.getActiveJobs();
      const workingProjects = Array.from(this.projectWorkers.keys());
      
      return {
        activeJobs,
        workingProjects,
        totalWorkers: this.projectWorkers.size,
        maxConcurrentProjects: this.maxConcurrentProjects
      };
    } catch (error) {
      console.error('❌ Error getting job status:', error);
      return {
        activeJobs: [],
        workingProjects: [],
        totalWorkers: 0,
        maxConcurrentProjects: this.maxConcurrentProjects
      };
    }
  }
}

// Create singleton instance
const jobWorker = new JobWorker();

export default jobWorker;