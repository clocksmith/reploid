/**
 * @fileoverview CLI Mode - Entry point for terminal-based interface
 * Coordinates Terminal, Shell, and History modules.
 */

const CLIMode = {
  metadata: {
    id: 'CLIMode',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus', 'VFS', 'Terminal', 'Shell', 'History', 'AgentLoop?', 'LLMClient?', 'StateManager?'],
    async: false,  // Don't auto-init - needs container ID
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, EventBus, VFS, Terminal, Shell, History, AgentLoop, LLMClient, StateManager } = deps;
    const { logger } = Utils;

    const { colors } = Terminal;
    let isAgentRunning = false;
    let approvalMode = 'suggest'; // suggest, auto-edit, full-auto
    let verboseMode = false;
    let pendingApproval = null;

    const init = async (containerId) => {
      logger.info('[CLIMode] Initializing...');

      // Initialize terminal
      await Terminal.init(containerId);

      // Initialize history
      await History.init();

      // Update prompt with cwd
      updatePrompt();

      // Handle command input
      Terminal.onInput(handleCommand);

      // Handle tab completion
      Terminal.onCompletion(handleTabCompletion);

      // Handle slash commands
      EventBus.on('cli:slash', handleSlashCommand);

      // Handle agent events
      EventBus.on('agent:thinking', () => {
        if (verboseMode) {
          Terminal.writeLine(`${colors.dim}Thinking...${colors.reset}`);
        }
      });

      EventBus.on('agent:tool:call', ({ name, args }) => {
        const argsStr = JSON.stringify(args, null, verboseMode ? 2 : 0);
        const shortArgs = argsStr.length > 100 ? argsStr.slice(0, 100) + '...' : argsStr;

        // File write operations
        const isFileWrite = ['write_file', 'delete_file'].includes(name);
        // Potentially dangerous operations
        const isDangerous = ['create_tool', 'load_module'].includes(name);

        // Color based on operation type
        let color = colors.yellow;
        if (isFileWrite) color = colors.cyan;
        if (isDangerous) color = colors.magenta;

        Terminal.writeLine(`${color}> ${name}${colors.reset} ${colors.dim}${shortArgs}${colors.reset}`);

        // Show file content preview for write operations
        if (name === 'write_file' && args.content && verboseMode) {
          const preview = args.content.slice(0, 200);
          Terminal.writeLine(`${colors.dim}  ${preview}${args.content.length > 200 ? '...' : ''}${colors.reset}`);
        }
      });

      EventBus.on('agent:tool:result', ({ name, result }) => {
        if (verboseMode) {
          if (typeof result === 'string' && result.length < 500) {
            Terminal.writeLine(`${colors.green}  ${result}${colors.reset}`);
          } else {
            Terminal.writeLine(`${colors.green}  [${name} completed]${colors.reset}`);
          }
        }
      });

      EventBus.on('agent:response', ({ content }) => {
        Terminal.writeLine('');
        // Format agent response with word wrap
        const lines = content.split('\n');
        for (const line of lines) {
          Terminal.writeLine(line);
        }
        Terminal.writeLine('');
        Terminal.showPrompt();
      });

      EventBus.on('agent:error', ({ error }) => {
        Terminal.writeLine(`${colors.red}Error: ${error}${colors.reset}`);
        Terminal.showPrompt();
      });

      EventBus.on('agent:done', () => {
        isAgentRunning = false;
        Terminal.showPrompt();
      });

      EventBus.on('agent:iteration', ({ iteration, maxIterations }) => {
        if (verboseMode) {
          Terminal.writeLine(`${colors.dim}[Iteration ${iteration}/${maxIterations}]${colors.reset}`);
        }
      });

      // Handle interrupts
      EventBus.on('cli:interrupt', () => {
        if (isAgentRunning && AgentLoop) {
          AgentLoop.stop();
          isAgentRunning = false;
        }
      });

      logger.info('[CLIMode] Ready');
      return true;
    };

    const updatePrompt = () => {
      const cwd = Shell.getCwd();
      const shortCwd = cwd === '/' ? '/' : cwd.split('/').pop() || '/';
      Terminal.setPrompt(`${colors.cyan}${shortCwd}${colors.reset} ${colors.dim}$${colors.reset} `);
    };

    const handleCommand = async (input) => {
      // Add to history
      await History.add(input);
      History.reset();

      // Check if this is a natural language request for the agent
      const isAgentRequest = input.startsWith('@') ||
        input.toLowerCase().startsWith('please ') ||
        input.toLowerCase().startsWith('can you ') ||
        input.toLowerCase().startsWith('help me ');

      if (isAgentRequest && AgentLoop) {
        await handleAgentRequest(input.replace(/^@\s*/, ''));
        return;
      }

      // Execute shell command
      try {
        const result = await Shell.execute(input);
        if (result) {
          Terminal.writeLine(result);
        }
      } catch (e) {
        Terminal.writeLine(`${colors.red}${e.message}${colors.reset}`);
      }

      updatePrompt();
      Terminal.showPrompt();
    };

    const handleAgentRequest = async (prompt) => {
      if (!AgentLoop) {
        Terminal.writeLine(`${colors.red}Agent not available${colors.reset}`);
        Terminal.showPrompt();
        return;
      }

      isAgentRunning = true;
      Terminal.writeLine(`${colors.cyan}${colors.bold}Agent:${colors.reset} Processing...`);

      try {
        await AgentLoop.run(prompt);
      } catch (e) {
        Terminal.writeLine(`${colors.red}Agent error: ${e.message}${colors.reset}`);
      }

      isAgentRunning = false;
    };

    let lastCompletions = [];
    let completionIndex = 0;

    const handleTabCompletion = async (input, cursorPos) => {
      try {
        const result = await Shell.getCompletions(input, cursorPos);
        const { partial, completions } = result;

        if (completions.length === 0) {
          // No completions - do nothing or beep
          return;
        }

        if (completions.length === 1) {
          // Single match - complete it
          const completion = completions[0];
          const beforePartial = input.slice(0, cursorPos - partial.length);
          const afterCursor = input.slice(cursorPos);
          const newInput = beforePartial + completion + (completion.endsWith('/') ? '' : ' ') + afterCursor;
          Terminal.setInput(newInput);
        } else {
          // Multiple matches
          // Find common prefix
          const commonPrefix = findCommonPrefix(completions);

          if (commonPrefix.length > partial.length) {
            // Complete to common prefix
            const beforePartial = input.slice(0, cursorPos - partial.length);
            const afterCursor = input.slice(cursorPos);
            const newInput = beforePartial + commonPrefix + afterCursor;
            Terminal.setInput(newInput);
          } else {
            // Show all completions
            Terminal.writeLine('');
            const formatted = formatCompletions(completions);
            Terminal.writeLine(formatted);
            Terminal.showPrompt();
            Terminal.setInput(input);
          }
        }
      } catch (e) {
        logger.error('[CLIMode] Tab completion error:', e);
      }
    };

    const findCommonPrefix = (strings) => {
      if (strings.length === 0) return '';
      if (strings.length === 1) return strings[0];

      let prefix = strings[0];
      for (let i = 1; i < strings.length; i++) {
        while (!strings[i].startsWith(prefix)) {
          prefix = prefix.slice(0, -1);
          if (prefix === '') return '';
        }
      }
      return prefix;
    };

    const formatCompletions = (completions) => {
      // Display completions in columns
      const maxLen = Math.max(...completions.map(c => c.length)) + 2;
      const termWidth = 80;
      const cols = Math.max(1, Math.floor(termWidth / maxLen));
      const rows = Math.ceil(completions.length / cols);

      const lines = [];
      for (let r = 0; r < rows; r++) {
        const rowItems = [];
        for (let c = 0; c < cols; c++) {
          const idx = r + c * rows;
          if (idx < completions.length) {
            const item = completions[idx];
            // Color directories differently
            if (item.endsWith('/')) {
              rowItems.push(`${colors.blue}${item.padEnd(maxLen)}${colors.reset}`);
            } else {
              rowItems.push(item.padEnd(maxLen));
            }
          }
        }
        lines.push(rowItems.join(''));
      }
      return lines.join('\n');
    };

    const handleSlashCommand = async ({ command, args }) => {
      switch (command) {
        case '/help':
          showHelp();
          break;
        case '/status':
          showStatus();
          break;
        case '/mode':
          setMode(args[0]);
          break;
        case '/history':
          showHistory();
          break;
        case '/clear':
          Terminal.clear();
          break;
        case '/export':
          await exportSession();
          break;
        case '/model':
          showModel(args[0]);
          break;
        case '/verbose':
          verboseMode = true;
          Terminal.writeLine(`${colors.green}Verbose mode enabled${colors.reset}`);
          break;
        case '/compact':
          verboseMode = false;
          Terminal.writeLine(`${colors.green}Compact mode enabled${colors.reset}`);
          break;
        case '/files':
          await listFiles(args[0]);
          break;
        case '/read':
          await readFile(args[0]);
          break;
        case '/stop':
          if (isAgentRunning && AgentLoop) {
            AgentLoop.stop();
            isAgentRunning = false;
            Terminal.writeLine(`${colors.yellow}Agent stopped${colors.reset}`);
          }
          break;
        default:
          Terminal.writeLine(`${colors.red}Unknown command: ${command}${colors.reset}`);
          Terminal.writeLine(`${colors.dim}Type /help for available commands${colors.reset}`);
      }
      Terminal.showPrompt();
    };

    const showHelp = () => {
      Terminal.writeLine(`
${colors.cyan}${colors.bold}Slash Commands${colors.reset}

${colors.yellow}General:${colors.reset}
  /help          Show this help
  /status        Show agent and system status
  /clear         Clear the terminal

${colors.yellow}Agent Control:${colors.reset}
  /mode [mode]   Set approval mode (suggest, auto-edit, full-auto)
  /model [name]  Show or set current model
  /stop          Stop running agent
  /verbose       Enable detailed output
  /compact       Enable compact output

${colors.yellow}File Operations:${colors.reset}
  /files [dir]   List files in VFS
  /read <file>   Display file contents
  /export        Export session data

${colors.yellow}Session:${colors.reset}
  /history       Show command history

${colors.yellow}Agent Interaction${colors.reset}

  @<prompt>      Send a request to the AI agent

  ${colors.dim}Examples:${colors.reset}
    @list all files and describe them
    @create a todo app in /apps/todo/
    @explain the VFS implementation
    @fix the bug in tool-runner.js

${colors.yellow}Keyboard Shortcuts${colors.reset}

  Tab           Autocomplete commands and file paths
  Up/Down       Navigate command history
  Ctrl+C        Cancel current operation
  Ctrl+L        Clear the terminal
  Home/End      Move cursor to start/end of line
`);
    };

    const showStatus = async () => {
      const env = Shell.getEnv();
      const files = await VFS.list('/');
      const state = StateManager ? StateManager.getState() : {};

      // Get current model
      let modelName = 'Not configured';
      try {
        const savedModels = localStorage.getItem('SELECTED_MODELS');
        if (savedModels) {
          const models = JSON.parse(savedModels);
          if (models.length > 0) {
            modelName = models[0].model || models[0].id || 'Unknown';
          }
        }
      } catch (e) {
        // Ignore
      }

      Terminal.writeLine(`
${colors.cyan}${colors.bold}REPLOID CLI Status${colors.reset}

${colors.yellow}System:${colors.reset}
  Working Directory: ${Shell.getCwd()}
  VFS Files:         ${files.length}
  Agent Cycles:      ${state.totalCycles || 0}

${colors.yellow}Agent:${colors.reset}
  Status:            ${isAgentRunning ? colors.green + 'Running' : colors.dim + 'Idle'}${colors.reset}
  Model:             ${modelName}
  Approval Mode:     ${approvalMode}
  Output:            ${verboseMode ? 'Verbose' : 'Compact'}

${colors.yellow}Environment:${colors.reset}
  Shell:             ${env.SHELL}
  User:              ${env.USER}
`);
    };

    const setMode = (mode) => {
      const validModes = ['suggest', 'auto-edit', 'full-auto'];
      if (!mode) {
        Terminal.writeLine(`Current mode: ${colors.cyan}${approvalMode}${colors.reset}`);
        Terminal.writeLine(`Available: ${validModes.join(', ')}`);
        return;
      }

      if (validModes.includes(mode)) {
        approvalMode = mode;
        Terminal.writeLine(`${colors.green}Mode set to: ${mode}${colors.reset}`);
      } else {
        Terminal.writeLine(`${colors.red}Invalid mode. Choose: ${validModes.join(', ')}${colors.reset}`);
      }
    };

    const showHistory = () => {
      const history = History.getAll();
      const recent = history.slice(-20);
      Terminal.writeLine(`${colors.dim}Last ${recent.length} commands:${colors.reset}`);
      recent.forEach((cmd, i) => {
        Terminal.writeLine(`  ${colors.dim}${history.length - recent.length + i + 1}${colors.reset}  ${cmd}`);
      });
    };

    const exportSession = async () => {
      const history = History.getAll();
      const files = await VFS.list('/');

      const session = {
        timestamp: new Date().toISOString(),
        history,
        fileCount: files.length
      };

      const json = JSON.stringify(session, null, 2);
      Terminal.writeLine(`${colors.dim}Session data:${colors.reset}`);
      Terminal.writeLine(json);
    };

    const showModel = (newModel) => {
      if (!newModel) {
        // Show current model
        try {
          const savedModels = localStorage.getItem('SELECTED_MODELS');
          if (savedModels) {
            const models = JSON.parse(savedModels);
            if (models.length > 0) {
              Terminal.writeLine(`Current model: ${colors.cyan}${models[0].model || models[0].id}${colors.reset}`);
              Terminal.writeLine(`Provider: ${colors.dim}${models[0].provider || 'unknown'}${colors.reset}`);
            } else {
              Terminal.writeLine(`${colors.yellow}No model configured${colors.reset}`);
            }
          }
        } catch (e) {
          Terminal.writeLine(`${colors.red}Error reading model config${colors.reset}`);
        }
        return;
      }

      // Model switching would require updating localStorage and possibly re-initializing
      Terminal.writeLine(`${colors.yellow}Model switching from CLI not yet supported${colors.reset}`);
      Terminal.writeLine(`${colors.dim}Configure models in the boot screen${colors.reset}`);
    };

    const listFiles = async (dir) => {
      try {
        const path = dir || '/';
        const files = await VFS.list(path);

        if (files.length === 0) {
          Terminal.writeLine(`${colors.dim}(empty)${colors.reset}`);
          return;
        }

        Terminal.writeLine(`${colors.cyan}${path}${colors.reset}:`);
        for (const file of files.sort()) {
          const stat = await VFS.stat(file);
          const name = file.split('/').pop();
          const size = stat ? `${stat.size}b` : '';
          Terminal.writeLine(`  ${name} ${colors.dim}${size}${colors.reset}`);
        }
      } catch (e) {
        Terminal.writeLine(`${colors.red}Error: ${e.message}${colors.reset}`);
      }
    };

    const readFile = async (filepath) => {
      if (!filepath) {
        Terminal.writeLine(`${colors.red}Usage: /read <file>${colors.reset}`);
        return;
      }

      try {
        const path = filepath.startsWith('/') ? filepath : '/' + filepath;
        const content = await VFS.read(path);

        Terminal.writeLine(`${colors.cyan}${path}${colors.reset}:`);
        Terminal.writeLine('');

        // Split content and display with line numbers
        const lines = content.split('\n');
        const maxLineNum = String(lines.length).length;

        for (let i = 0; i < Math.min(lines.length, 50); i++) {
          const lineNum = String(i + 1).padStart(maxLineNum);
          Terminal.writeLine(`${colors.dim}${lineNum}${colors.reset} ${lines[i]}`);
        }

        if (lines.length > 50) {
          Terminal.writeLine(`${colors.dim}... (${lines.length - 50} more lines)${colors.reset}`);
        }
      } catch (e) {
        Terminal.writeLine(`${colors.red}Error: ${e.message}${colors.reset}`);
      }
    };

    const focus = () => {
      Terminal.focus();
    };

    const dispose = () => {
      Terminal.dispose();
    };

    return {
      init,
      focus,
      dispose,
      get isReady() { return Terminal.isReady; }
    };
  }
};

export default CLIMode;
