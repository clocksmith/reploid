// Console Logger Tools - Give agent access to console logs

export const tools = [
  {
    name: 'read_console_logs',
    description: 'Read browser console logs that have been persisted to VFS',
    handler: async (args) => {
      const consoleLogger = window.REPLOID?.consoleLogger;
      if (!consoleLogger) {
        return { error: 'Console logger not initialized' };
      }

      try {
        const logs = await consoleLogger.readLogs();

        // If filter provided, filter the logs
        if (args.filter) {
          const lines = logs.split('\n');
          const filtered = lines.filter(line =>
            line.toLowerCase().includes(args.filter.toLowerCase())
          );
          return {
            success: true,
            logs: filtered.join('\n'),
            totalLines: lines.length,
            filteredLines: filtered.length
          };
        }

        // If tail provided, return last N lines
        if (args.tail) {
          const lines = logs.split('\n');
          const tailLines = lines.slice(-args.tail);
          return {
            success: true,
            logs: tailLines.join('\n'),
            totalLines: lines.length,
            showing: tailLines.length
          };
        }

        return {
          success: true,
          logs,
          totalLines: logs.split('\n').length
        };
      } catch (error) {
        return { error: error.message };
      }
    }
  },
  {
    name: 'clear_console_logs',
    description: 'Clear all persisted console logs from VFS',
    handler: async (args) => {
      const consoleLogger = window.REPLOID?.consoleLogger;
      if (!consoleLogger) {
        return { error: 'Console logger not initialized' };
      }

      try {
        await consoleLogger.clearLogs();
        return { success: true, message: 'Console logs cleared' };
      } catch (error) {
        return { error: error.message };
      }
    }
  },
  {
    name: 'get_log_file_path',
    description: 'Get the VFS path where console logs are stored',
    handler: async (args) => {
      const consoleLogger = window.REPLOID?.consoleLogger;
      if (!consoleLogger) {
        return { error: 'Console logger not initialized' };
      }

      return {
        success: true,
        path: consoleLogger.getLogPath(),
        message: 'Console logs are saved to this VFS path automatically every 2 seconds'
      };
    }
  }
];
