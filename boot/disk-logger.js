// Disk Logger - Automatically saves agent activity, VFS, and logs to disk
// This runs alongside console-logger to provide persistent state tracking

const DiskLogger = {
  metadata: {
    name: 'DiskLogger',
    version: '1.0.0'
  },

  factory: (deps) => {
    const { vfs } = deps;

    const LOG_DIR = '/logs/disk';
    const ITERATION_LOG = `${LOG_DIR}/iterations.jsonl`; // JSON Lines format
    const VFS_SNAPSHOT_DIR = `${LOG_DIR}/vfs-snapshots`;
    const EVENTS_LOG = `${LOG_DIR}/events.jsonl`;
    const SESSION_ID = Date.now();

    let iterationCount = 0;
    let eventBuffer = [];
    let autoSaveInterval = null;

    // Initialize logging directories
    const init = async () => {
      try {
        // Create log directories
        const dirs = [LOG_DIR, VFS_SNAPSHOT_DIR];
        for (const dir of dirs) {
          try {
            await vfs.list(dir);
          } catch {
            await vfs.write(`${dir}/.gitkeep`, '');
          }
        }

        // Write session start marker
        await logEvent({
          type: 'session_start',
          session_id: SESSION_ID,
          timestamp: new Date().toISOString(),
          max_iterations: 5000
        });

        console.info('[DiskLogger] Initialized - logging to VFS ' + LOG_DIR);
        return true;
      } catch (error) {
        console.error('[DiskLogger] Initialization failed:', error);
        return false;
      }
    };

    // Log a single event to events.jsonl
    const logEvent = async (event) => {
      try {
        const eventLine = JSON.stringify({
          ...event,
          session_id: SESSION_ID,
          timestamp: event.timestamp || new Date().toISOString()
        }) + '\n';

        // Append to events log
        let existing = '';
        try {
          existing = await vfs.read(EVENTS_LOG);
        } catch {}

        await vfs.write(EVENTS_LOG, existing + eventLine);
        return true;
      } catch (error) {
        console.error('[DiskLogger] Failed to log event:', error);
        return false;
      }
    };

    // Log an iteration with full context
    const logIteration = async (iteration) => {
      try {
        iterationCount++;

        const iterationData = {
          session_id: SESSION_ID,
          iteration: iterationCount,
          timestamp: new Date().toISOString(),
          goal: iteration.goal || 'unknown',
          llm_response: iteration.llm_response ? iteration.llm_response.substring(0, 500) : '',
          tool_calls: iteration.tool_calls || [],
          tool_results: iteration.tool_results || [],
          context_size: iteration.context_size || 0,
          context_tokens: iteration.context_tokens || 0,
          errors: iteration.errors || []
        };

        // Append to iterations.jsonl
        const iterationLine = JSON.stringify(iterationData) + '\n';
        let existing = '';
        try {
          existing = await vfs.read(ITERATION_LOG);
        } catch {}

        await vfs.write(ITERATION_LOG, existing + iterationLine);

        // Also log as event
        await logEvent({
          type: 'iteration',
          iteration: iterationCount,
          tool_calls_count: iterationData.tool_calls.length
        });

        // Snapshot VFS every 10 iterations
        if (iterationCount % 10 === 0) {
          await snapshotVFS(iterationCount);
        }

        return true;
      } catch (error) {
        console.error('[DiskLogger] Failed to log iteration:', error);
        return false;
      }
    };

    // Snapshot entire VFS to a timestamped file
    const snapshotVFS = async (iteration = null) => {
      try {
        const snapshotName = iteration
          ? `snapshot-iter${iteration}-${Date.now()}.json`
          : `snapshot-${Date.now()}.json`;

        // Get all VFS files
        const allFiles = await vfs.list('/');
        const snapshot = {
          timestamp: new Date().toISOString(),
          session_id: SESSION_ID,
          iteration: iteration || iterationCount,
          files: {}
        };

        // Read all files recursively
        const readDir = async (path) => {
          try {
            const files = await vfs.list(path);
            for (const file of files) {
              const fullPath = path === '/' ? `/${file}` : `${path}/${file}`;

              try {
                // Try to read as file
                const content = await vfs.read(fullPath);
                snapshot.files[fullPath] = content;
              } catch {
                // Might be a directory, try to recurse
                try {
                  await readDir(fullPath);
                } catch {}
              }
            }
          } catch (error) {
            console.warn(`[DiskLogger] Could not read ${path}:`, error.message);
          }
        };

        await readDir('/');

        // Save snapshot
        const snapshotPath = `${VFS_SNAPSHOT_DIR}/${snapshotName}`;
        await vfs.write(snapshotPath, JSON.stringify(snapshot, null, 2));

        console.log(`[DiskLogger] VFS snapshot saved: ${snapshotPath} (${Object.keys(snapshot.files).length} files)`);

        await logEvent({
          type: 'vfs_snapshot',
          path: snapshotPath,
          file_count: Object.keys(snapshot.files).length
        });

        return snapshotPath;
      } catch (error) {
        console.error('[DiskLogger] VFS snapshot failed:', error);
        return null;
      }
    };

    // Log tool creation
    const logToolCreation = async (toolName, toolPath, success = true) => {
      await logEvent({
        type: 'tool_created',
        tool_name: toolName,
        tool_path: toolPath,
        success
      });
    };

    // Log tool execution
    const logToolExecution = async (toolName, args, result, error = null) => {
      await logEvent({
        type: 'tool_executed',
        tool_name: toolName,
        args: JSON.stringify(args).substring(0, 200),
        success: !error,
        error: error ? error.message : null,
        result_preview: result ? JSON.stringify(result).substring(0, 200) : null
      });
    };

    // Log widget creation
    const logWidgetCreation = async (widgetName, widgetPath) => {
      await logEvent({
        type: 'widget_created',
        widget_name: widgetName,
        widget_path: widgetPath
      });
    };

    // Auto-save on interval
    const startAutoSave = (intervalMs = 30000) => { // Every 30 seconds
      if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
      }

      autoSaveInterval = setInterval(async () => {
        await snapshotVFS();
      }, intervalMs);

      console.info(`[DiskLogger] Auto-save started (every ${intervalMs/1000}s)`);
    };

    const stopAutoSave = () => {
      if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
        autoSaveInterval = null;
        console.info('[DiskLogger] Auto-save stopped');
      }
    };

    // Get log summary
    const getSummary = async () => {
      try {
        // Read iteration log
        let iterations = [];
        try {
          const iterLog = await vfs.read(ITERATION_LOG);
          iterations = iterLog.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
        } catch {}

        // Read events log
        let events = [];
        try {
          const evLog = await vfs.read(EVENTS_LOG);
          events = evLog.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
        } catch {}

        // Count snapshots
        let snapshots = [];
        try {
          snapshots = await vfs.list(VFS_SNAPSHOT_DIR);
        } catch {}

        return {
          session_id: SESSION_ID,
          total_iterations: iterations.length,
          total_events: events.length,
          total_snapshots: snapshots.length - 1, // Exclude .gitkeep
          first_iteration: iterations[0] || null,
          last_iteration: iterations[iterations.length - 1] || null,
          event_types: [...new Set(events.map(e => e.type))],
          log_paths: {
            iterations: ITERATION_LOG,
            events: EVENTS_LOG,
            snapshots: VFS_SNAPSHOT_DIR
          }
        };
      } catch (error) {
        console.error('[DiskLogger] Failed to get summary:', error);
        return null;
      }
    };

    // Export all logs as single file (for download)
    const exportAll = async () => {
      try {
        const summary = await getSummary();

        // Read all log files
        let iterationsLog = '';
        let eventsLog = '';
        try {
          iterationsLog = await vfs.read(ITERATION_LOG);
        } catch {}
        try {
          eventsLog = await vfs.read(EVENTS_LOG);
        } catch {}

        const exportData = {
          timestamp: new Date().toISOString(),
          session_id: SESSION_ID,
          summary,
          iterations: iterationsLog.split('\n').filter(l => l.trim()).map(l => {
            try { return JSON.parse(l); } catch { return null; }
          }).filter(Boolean),
          events: eventsLog.split('\n').filter(l => l.trim()).map(l => {
            try { return JSON.parse(l); } catch { return null; }
          }).filter(Boolean)
        };

        const exportPath = `/logs/export-session-${SESSION_ID}.json`;
        await vfs.write(exportPath, JSON.stringify(exportData, null, 2));

        console.log(`[DiskLogger] Export saved: ${exportPath}`);
        return exportPath;
      } catch (error) {
        console.error('[DiskLogger] Export failed:', error);
        return null;
      }
    };

    return {
      init,
      logEvent,
      logIteration,
      logToolCreation,
      logToolExecution,
      logWidgetCreation,
      snapshotVFS,
      startAutoSave,
      stopAutoSave,
      getSummary,
      exportAll,
      getSessionId: () => SESSION_ID
    };
  }
};

export default DiskLogger;
