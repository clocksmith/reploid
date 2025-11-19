// Console Logger - Persist browser console logs to VFS for crash recovery

const ConsoleLogger = {
  metadata: {
    name: 'ConsoleLogger',
    version: '1.0.0'
  },

  factory: (deps) => {
    const { vfs } = deps;

    const LOG_FILE = '/logs/console.log';
    const MAX_LOG_SIZE = 1000000; // 1MB max log file size
    let logBuffer = [];
    let flushTimeout = null;
    const FLUSH_INTERVAL = 2000; // Flush every 2 seconds

    // Original console methods
    const originalConsole = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug
    };

    // Format timestamp
    const timestamp = () => {
      const now = new Date();
      return now.toISOString();
    };

    // Flush buffer to VFS
    const flushLogs = async () => {
      if (logBuffer.length === 0) return;

      try {
        // Read existing log file
        let existingContent = '';
        try {
          existingContent = await vfs.readFile(LOG_FILE);
        } catch (error) {
          // File doesn't exist yet, that's fine
        }

        // Append new logs
        const newContent = existingContent + logBuffer.join('\n') + '\n';

        // Trim if too large (keep last 80% when limit hit)
        let finalContent = newContent;
        if (newContent.length > MAX_LOG_SIZE) {
          const lines = newContent.split('\n');
          const keepLines = Math.floor(lines.length * 0.8);
          finalContent = lines.slice(-keepLines).join('\n');
          console.info('[ConsoleLogger] Log file trimmed to 80% to stay under size limit');
        }

        // Write to VFS
        await vfs.writeFile(LOG_FILE, finalContent);

        // Clear buffer
        logBuffer = [];
      } catch (error) {
        // Don't use console here to avoid infinite loop
        originalConsole.error('[ConsoleLogger] Failed to flush logs:', error);
      }
    };

    // Schedule flush
    const scheduleFlush = () => {
      if (flushTimeout) {
        clearTimeout(flushTimeout);
      }
      flushTimeout = setTimeout(flushLogs, FLUSH_INTERVAL);
    };

    // Add log entry to buffer
    const addLogEntry = (level, args) => {
      try {
        const message = args.map(arg => {
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg, null, 2);
            } catch {
              return String(arg);
            }
          }
          return String(arg);
        }).join(' ');

        const entry = `[${timestamp()}] [${level.toUpperCase()}] ${message}`;
        logBuffer.push(entry);

        scheduleFlush();
      } catch (error) {
        // Silently fail - don't want to break console if logging fails
      }
    };

    // Intercept console methods
    const intercept = () => {
      console.log = (...args) => {
        originalConsole.log(...args);
        addLogEntry('log', args);
      };

      console.info = (...args) => {
        originalConsole.info(...args);
        addLogEntry('info', args);
      };

      console.warn = (...args) => {
        originalConsole.warn(...args);
        addLogEntry('warn', args);
      };

      console.error = (...args) => {
        originalConsole.error(...args);
        addLogEntry('error', args);
      };

      console.debug = (...args) => {
        originalConsole.debug(...args);
        addLogEntry('debug', args);
      };

      console.info('[ConsoleLogger] Console logging intercepted - logs will be saved to VFS');
    };

    // Restore original console methods
    const restore = () => {
      console.log = originalConsole.log;
      console.info = originalConsole.info;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.debug = originalConsole.debug;

      // Flush any remaining logs
      flushLogs();
    };

    // Get log file path
    const getLogPath = () => LOG_FILE;

    // Clear logs
    const clearLogs = async () => {
      try {
        await vfs.deleteFile(LOG_FILE);
        logBuffer = [];
        console.info('[ConsoleLogger] Logs cleared');
      } catch (error) {
        console.error('[ConsoleLogger] Failed to clear logs:', error);
      }
    };

    // Read logs
    const readLogs = async () => {
      try {
        return await vfs.readFile(LOG_FILE);
      } catch (error) {
        console.warn('[ConsoleLogger] No logs found');
        return '';
      }
    };

    // Auto-intercept on init
    intercept();

    // Flush logs when page unloads (best effort)
    window.addEventListener('beforeunload', () => {
      // Use synchronous approach if available (this may not work in all browsers)
      if (logBuffer.length > 0) {
        // Try to flush immediately
        flushLogs().catch(() => {
          // Silently fail
        });
      }
    });

    // Periodic auto-flush
    setInterval(flushLogs, FLUSH_INTERVAL);

    return {
      intercept,
      restore,
      getLogPath,
      clearLogs,
      readLogs,
      flushLogs
    };
  }
};

export default ConsoleLogger;
