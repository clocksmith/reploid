/**
 * @fileoverview Terminal UI - xterm.js wrapper for CLI mode
 * Provides a browser-based terminal emulator with Unix-like experience.
 */

const Terminal = {
  metadata: {
    id: 'Terminal',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus'],
    async: false,  // Don't auto-init - we need container ID
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger } = Utils;

    let term = null;
    let fitAddon = null;
    let container = null;
    let inputBuffer = '';
    let cursorPosition = 0;
    let onInputCallback = null;
    let promptText = '$ ';
    let isReady = false;

    // ANSI color codes for styling
    const colors = {
      reset: '\x1b[0m',
      bold: '\x1b[1m',
      dim: '\x1b[2m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m',
      gray: '\x1b[90m'
    };

    const loadWithTimeout = (promise, ms, name) => {
      return Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout loading ${name}`)), ms)
        )
      ]);
    };

    const loadXterm = async () => {
      // Load xterm.js and addons from CDN with timeout
      const TIMEOUT = 15000; // 15 seconds

      try {
        if (!window.Terminal) {
          logger.info('[Terminal] Loading xterm core...');
          const xtermModule = await loadWithTimeout(
            import('https://cdn.jsdelivr.net/npm/xterm@5.3.0/+esm'),
            TIMEOUT,
            'xterm'
          );
          window.Terminal = xtermModule.Terminal;
        }
        if (!window.FitAddon) {
          logger.info('[Terminal] Loading fit addon...');
          const fitModule = await loadWithTimeout(
            import('https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/+esm'),
            TIMEOUT,
            'fit-addon'
          );
          window.FitAddon = fitModule.FitAddon;
        }
        if (!window.WebLinksAddon) {
          logger.info('[Terminal] Loading weblinks addon...');
          const linksModule = await loadWithTimeout(
            import('https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.11.0/+esm'),
            TIMEOUT,
            'weblinks-addon'
          );
          window.WebLinksAddon = linksModule.WebLinksAddon;
        }
        logger.info('[Terminal] All modules loaded');
      } catch (e) {
        logger.error('[Terminal] Failed to load xterm modules:', e.message);
        throw e;
      }
    };

    const init = async (containerId) => {
      logger.info('[Terminal] Loading xterm.js...');
      await loadXterm();

      container = document.getElementById(containerId);
      if (!container) {
        throw new Error(`Terminal container not found: ${containerId}`);
      }

      // Create terminal with dark theme
      term = new window.Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: 14,
        fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Monaco, monospace',
        theme: {
          background: '#0d1117',
          foreground: '#c9d1d9',
          cursor: '#58a6ff',
          cursorAccent: '#0d1117',
          selection: 'rgba(56, 139, 253, 0.4)',
          black: '#484f58',
          red: '#ff7b72',
          green: '#3fb950',
          yellow: '#d29922',
          blue: '#58a6ff',
          magenta: '#bc8cff',
          cyan: '#39c5cf',
          white: '#b1bac4',
          brightBlack: '#6e7681',
          brightRed: '#ffa198',
          brightGreen: '#56d364',
          brightYellow: '#e3b341',
          brightBlue: '#79c0ff',
          brightMagenta: '#d2a8ff',
          brightCyan: '#56d4dd',
          brightWhite: '#f0f6fc'
        },
        scrollback: 5000,
        convertEol: true
      });

      // Load addons
      fitAddon = new window.FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new window.WebLinksAddon());

      // Open terminal in container
      term.open(container);
      fitAddon.fit();

      // Handle window resize
      window.addEventListener('resize', () => {
        if (fitAddon) fitAddon.fit();
      });

      // Handle input
      term.onData(handleInput);

      isReady = true;
      logger.info('[Terminal] Ready');

      // Show welcome message
      writeLine(`${colors.cyan}${colors.bold}Agent Tools${colors.reset} ${colors.dim}v1.0.0${colors.reset}`);
      writeLine(`${colors.dim}Shell commands for REPLOID agent - type 'help' to list${colors.reset}`);
      writeLine('');
      showPrompt();

      return true;
    };

    let completionCallback = null;

    const handleInput = (data) => {
      // Handle special keys
      for (let i = 0; i < data.length; i++) {
        const char = data[i];
        const code = char.charCodeAt(0);

        if (code === 9) {
          // Tab - trigger completion
          if (completionCallback) {
            completionCallback(inputBuffer, cursorPosition);
          }
          continue;
        } else if (code === 13) {
          // Enter
          term.write('\r\n');
          const command = inputBuffer.trim();
          inputBuffer = '';
          cursorPosition = 0;

          if (command && onInputCallback) {
            onInputCallback(command);
          } else if (!command) {
            showPrompt();
          }
        } else if (code === 127 || code === 8) {
          // Backspace
          if (cursorPosition > 0) {
            inputBuffer = inputBuffer.slice(0, cursorPosition - 1) + inputBuffer.slice(cursorPosition);
            cursorPosition--;
            // Redraw line
            term.write('\x1b[2K\r'); // Clear line
            term.write(promptText + inputBuffer);
            // Move cursor to correct position
            if (cursorPosition < inputBuffer.length) {
              term.write(`\x1b[${inputBuffer.length - cursorPosition}D`);
            }
          }
        } else if (code === 3) {
          // Ctrl+C
          term.write('^C\r\n');
          inputBuffer = '';
          cursorPosition = 0;
          EventBus.emit('cli:interrupt');
          showPrompt();
        } else if (code === 12) {
          // Ctrl+L - clear screen
          term.clear();
          showPrompt();
        } else if (data.startsWith('\x1b[')) {
          // Arrow keys and other escape sequences
          handleEscapeSequence(data.slice(2));
          return; // Escape sequences are complete
        } else if (code >= 32) {
          // Printable characters
          inputBuffer = inputBuffer.slice(0, cursorPosition) + char + inputBuffer.slice(cursorPosition);
          cursorPosition++;
          // Redraw line
          term.write('\x1b[2K\r');
          term.write(promptText + inputBuffer);
          if (cursorPosition < inputBuffer.length) {
            term.write(`\x1b[${inputBuffer.length - cursorPosition}D`);
          }
        }
      }
    };

    const handleEscapeSequence = (seq) => {
      if (seq === 'A') {
        // Up arrow - history up
        EventBus.emit('cli:history:up', { callback: setInput });
      } else if (seq === 'B') {
        // Down arrow - history down
        EventBus.emit('cli:history:down', { callback: setInput });
      } else if (seq === 'C') {
        // Right arrow
        if (cursorPosition < inputBuffer.length) {
          cursorPosition++;
          term.write('\x1b[C');
        }
      } else if (seq === 'D') {
        // Left arrow
        if (cursorPosition > 0) {
          cursorPosition--;
          term.write('\x1b[D');
        }
      } else if (seq === '3~') {
        // Delete key
        if (cursorPosition < inputBuffer.length) {
          inputBuffer = inputBuffer.slice(0, cursorPosition) + inputBuffer.slice(cursorPosition + 1);
          term.write('\x1b[2K\r');
          term.write(promptText + inputBuffer);
          if (cursorPosition < inputBuffer.length) {
            term.write(`\x1b[${inputBuffer.length - cursorPosition}D`);
          }
        }
      } else if (seq === 'H') {
        // Home
        if (cursorPosition > 0) {
          term.write(`\x1b[${cursorPosition}D`);
          cursorPosition = 0;
        }
      } else if (seq === 'F') {
        // End
        if (cursorPosition < inputBuffer.length) {
          term.write(`\x1b[${inputBuffer.length - cursorPosition}C`);
          cursorPosition = inputBuffer.length;
        }
      }
    };

    const setInput = (text) => {
      inputBuffer = text || '';
      cursorPosition = inputBuffer.length;
      term.write('\x1b[2K\r');
      term.write(promptText + inputBuffer);
    };

    const write = (text) => {
      if (term) term.write(text);
    };

    const writeLine = (text) => {
      if (term) term.write(text + '\r\n');
    };

    const showPrompt = () => {
      if (term) term.write(promptText);
    };

    const setPrompt = (text) => {
      promptText = text;
    };

    const clear = () => {
      if (term) term.clear();
    };

    const focus = () => {
      if (term) term.focus();
    };

    const onInput = (callback) => {
      onInputCallback = callback;
    };

    const onCompletion = (callback) => {
      completionCallback = callback;
    };

    const getInputState = () => ({
      buffer: inputBuffer,
      cursor: cursorPosition
    });

    const dispose = () => {
      if (term) {
        term.dispose();
        term = null;
      }
    };

    const fit = () => {
      if (fitAddon) fitAddon.fit();
    };

    return {
      init,
      write,
      writeLine,
      showPrompt,
      setPrompt,
      setInput,
      clear,
      focus,
      onInput,
      onCompletion,
      getInputState,
      dispose,
      fit,
      colors,
      get isReady() { return isReady; }
    };
  }
};

export default Terminal;
