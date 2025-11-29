/**
 * @fileoverview Shell - Command parser and executor for CLI mode
 * Implements Unix-style commands backed by the VFS.
 */

const Shell = {
  metadata: {
    id: 'Shell',
    version: '1.0.0',
    dependencies: ['Utils', 'VFS', 'EventBus', 'Terminal', 'GitTools?'],
    async: false,  // Don't auto-init - initialized by CLIMode
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, EventBus, Terminal, GitTools } = deps;
    const { logger } = Utils;

    let cwd = '/';
    let env = {
      USER: 'reploid',
      HOME: '/',
      SHELL: '/bin/rsh',
      PWD: '/',
      TERM: 'xterm-256color'
    };

    const { colors } = Terminal;

    // Command registry
    const commands = {};

    // --- Path utilities ---

    const resolvePath = (path) => {
      if (!path) return cwd;
      if (path.startsWith('/')) return normalizePath(path);
      if (path.startsWith('~')) return normalizePath(env.HOME + path.slice(1));
      return normalizePath(cwd + '/' + path);
    };

    const normalizePath = (path) => {
      const parts = path.split('/').filter(Boolean);
      const stack = [];
      for (const part of parts) {
        if (part === '..') {
          stack.pop();
        } else if (part !== '.') {
          stack.push(part);
        }
      }
      return '/' + stack.join('/');
    };

    const dirname = (path) => {
      const parts = path.split('/').filter(Boolean);
      parts.pop();
      return '/' + parts.join('/');
    };

    const basename = (path) => {
      const parts = path.split('/').filter(Boolean);
      return parts.pop() || '';
    };

    // --- Parse command line ---

    const parseCommand = (line) => {
      const tokens = [];
      let current = '';
      let inQuote = null;
      let escape = false;

      for (const char of line) {
        if (escape) {
          current += char;
          escape = false;
        } else if (char === '\\') {
          escape = true;
        } else if (char === '"' || char === "'") {
          if (inQuote === char) {
            inQuote = null;
          } else if (!inQuote) {
            inQuote = char;
          } else {
            current += char;
          }
        } else if (char === ' ' && !inQuote) {
          if (current) {
            tokens.push(current);
            current = '';
          }
        } else {
          current += char;
        }
      }
      if (current) tokens.push(current);

      return tokens;
    };

    const expandEnvVars = (str) => {
      return str.replace(/\$(\w+)/g, (_, name) => env[name] || '');
    };

    // --- Built-in commands ---

    commands.pwd = async () => {
      return cwd;
    };

    commands.cd = async (args) => {
      const target = args[0] || env.HOME;
      const newPath = resolvePath(target);

      // VFS is flat - just check if any files exist under this path
      const files = await VFS.list(newPath);
      const parentFiles = await VFS.list('/');

      // Check if path would be valid (has files under it or is root)
      const isValidDir = newPath === '/' ||
        files.length > 0 ||
        parentFiles.some(f => f.startsWith(newPath + '/'));

      if (!isValidDir && newPath !== '/') {
        throw new Error(`cd: ${target}: No such directory`);
      }

      cwd = newPath;
      env.PWD = cwd;
      return '';
    };

    commands.ls = async (args) => {
      let showAll = false;
      let longFormat = false;
      let paths = [];

      for (const arg of args) {
        if (arg.startsWith('-')) {
          if (arg.includes('a')) showAll = true;
          if (arg.includes('l')) longFormat = true;
        } else {
          paths.push(arg);
        }
      }

      if (paths.length === 0) paths = ['.'];

      const results = [];
      for (const p of paths) {
        const fullPath = resolvePath(p);
        const prefix = fullPath === '/' ? '/' : fullPath + '/';
        const allFiles = await VFS.list('/');

        // Get files in this directory
        const entries = new Set();
        for (const file of allFiles) {
          if (file.startsWith(prefix)) {
            const relative = file.slice(prefix.length);
            const firstPart = relative.split('/')[0];
            if (firstPart && (showAll || !firstPart.startsWith('.'))) {
              entries.add(firstPart);
            }
          }
        }

        if (longFormat) {
          for (const entry of [...entries].sort()) {
            const entryPath = prefix + entry;
            const stat = await VFS.stat(entryPath);
            if (stat) {
              const size = String(stat.size).padStart(8);
              const date = new Date(stat.updated).toISOString().slice(0, 10);
              results.push(`${colors.dim}-rw-r--r--${colors.reset}  ${size}  ${date}  ${entry}`);
            } else {
              // It's a directory (has children)
              results.push(`${colors.blue}${colors.bold}drwxr-xr-x${colors.reset}         -  ----------  ${colors.blue}${entry}${colors.reset}`);
            }
          }
        } else {
          const sorted = [...entries].sort();
          // Color directories blue
          const colored = [];
          for (const entry of sorted) {
            const entryPath = prefix + entry;
            const stat = await VFS.stat(entryPath);
            if (stat) {
              colored.push(entry);
            } else {
              colored.push(`${colors.blue}${entry}${colors.reset}`);
            }
          }
          results.push(colored.join('  '));
        }
      }

      return results.join('\n');
    };

    commands.cat = async (args) => {
      if (args.length === 0) {
        throw new Error('cat: missing file operand');
      }

      const results = [];
      for (const file of args) {
        if (file.startsWith('-')) continue;
        const path = resolvePath(file);
        try {
          const content = await VFS.read(path);
          results.push(content);
        } catch (e) {
          throw new Error(`cat: ${file}: No such file`);
        }
      }
      return results.join('\n');
    };

    commands.head = async (args) => {
      let lines = 10;
      let files = [];

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-n' && args[i + 1]) {
          lines = parseInt(args[++i], 10);
        } else if (args[i].startsWith('-') && !isNaN(args[i].slice(1))) {
          lines = parseInt(args[i].slice(1), 10);
        } else if (!args[i].startsWith('-')) {
          files.push(args[i]);
        }
      }

      if (files.length === 0) {
        throw new Error('head: missing file operand');
      }

      const results = [];
      for (const file of files) {
        const path = resolvePath(file);
        try {
          const content = await VFS.read(path);
          const fileLines = content.split('\n').slice(0, lines);
          results.push(fileLines.join('\n'));
        } catch (e) {
          throw new Error(`head: ${file}: No such file`);
        }
      }
      return results.join('\n');
    };

    commands.tail = async (args) => {
      let lines = 10;
      let files = [];

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-n' && args[i + 1]) {
          lines = parseInt(args[++i], 10);
        } else if (args[i].startsWith('-') && !isNaN(args[i].slice(1))) {
          lines = parseInt(args[i].slice(1), 10);
        } else if (!args[i].startsWith('-')) {
          files.push(args[i]);
        }
      }

      if (files.length === 0) {
        throw new Error('tail: missing file operand');
      }

      const results = [];
      for (const file of files) {
        const path = resolvePath(file);
        try {
          const content = await VFS.read(path);
          const allLines = content.split('\n');
          const fileLines = allLines.slice(-lines);
          results.push(fileLines.join('\n'));
        } catch (e) {
          throw new Error(`tail: ${file}: No such file`);
        }
      }
      return results.join('\n');
    };

    commands.echo = async (args) => {
      const text = args.join(' ');
      return expandEnvVars(text);
    };

    commands.mkdir = async (args) => {
      for (const dir of args) {
        if (dir.startsWith('-')) continue;
        const path = resolvePath(dir);
        await VFS.mkdir(path);
      }
      return '';
    };

    commands.touch = async (args) => {
      for (const file of args) {
        if (file.startsWith('-')) continue;
        const path = resolvePath(file);
        const exists = await VFS.exists(path);
        if (!exists) {
          await VFS.write(path, '');
        }
      }
      return '';
    };

    commands.rm = async (args) => {
      let recursive = false;
      let force = false;
      const files = [];

      for (const arg of args) {
        if (arg.startsWith('-')) {
          if (arg.includes('r') || arg.includes('R')) recursive = true;
          if (arg.includes('f')) force = true;
        } else {
          files.push(arg);
        }
      }

      for (const file of files) {
        const path = resolvePath(file);
        try {
          if (recursive) {
            // Delete all files under this path
            const allFiles = await VFS.list('/');
            for (const f of allFiles) {
              if (f === path || f.startsWith(path + '/')) {
                await VFS.delete(f);
              }
            }
          } else {
            await VFS.delete(path);
          }
        } catch (e) {
          if (!force) throw new Error(`rm: ${file}: No such file`);
        }
      }
      return '';
    };

    commands.cp = async (args) => {
      if (args.length < 2) {
        throw new Error('cp: missing destination file operand');
      }
      const src = resolvePath(args[0]);
      const dest = resolvePath(args[1]);

      try {
        const content = await VFS.read(src);
        await VFS.write(dest, content);
      } catch (e) {
        throw new Error(`cp: ${args[0]}: No such file`);
      }
      return '';
    };

    commands.mv = async (args) => {
      if (args.length < 2) {
        throw new Error('mv: missing destination file operand');
      }
      const src = resolvePath(args[0]);
      const dest = resolvePath(args[1]);

      try {
        const content = await VFS.read(src);
        await VFS.write(dest, content);
        await VFS.delete(src);
      } catch (e) {
        throw new Error(`mv: ${args[0]}: No such file`);
      }
      return '';
    };

    commands.wc = async (args) => {
      let countLines = false, countWords = false, countBytes = false;
      const files = [];

      for (const arg of args) {
        if (arg.startsWith('-')) {
          if (arg.includes('l')) countLines = true;
          if (arg.includes('w')) countWords = true;
          if (arg.includes('c')) countBytes = true;
        } else {
          files.push(arg);
        }
      }

      // Default: show all
      if (!countLines && !countWords && !countBytes) {
        countLines = countWords = countBytes = true;
      }

      const results = [];
      for (const file of files) {
        const path = resolvePath(file);
        try {
          const content = await VFS.read(path);
          const lines = content.split('\n').length;
          const words = content.split(/\s+/).filter(Boolean).length;
          const bytes = new TextEncoder().encode(content).length;

          const parts = [];
          if (countLines) parts.push(String(lines).padStart(8));
          if (countWords) parts.push(String(words).padStart(8));
          if (countBytes) parts.push(String(bytes).padStart(8));
          parts.push(file);
          results.push(parts.join(' '));
        } catch (e) {
          throw new Error(`wc: ${file}: No such file`);
        }
      }
      return results.join('\n');
    };

    commands.grep = async (args) => {
      let ignoreCase = false;
      let showLineNum = false;
      let pattern = null;
      const files = [];

      for (const arg of args) {
        if (arg.startsWith('-')) {
          if (arg.includes('i')) ignoreCase = true;
          if (arg.includes('n')) showLineNum = true;
        } else if (!pattern) {
          pattern = arg;
        } else {
          files.push(arg);
        }
      }

      if (!pattern) {
        throw new Error('grep: missing pattern');
      }

      const regex = new RegExp(pattern, ignoreCase ? 'gi' : 'g');
      const results = [];

      // If no files, search all files in cwd
      if (files.length === 0) {
        const allFiles = await VFS.list(cwd);
        files.push(...allFiles.map(f => f.slice(cwd.length + (cwd === '/' ? 0 : 1))));
      }

      for (const file of files) {
        const path = resolvePath(file);
        try {
          const content = await VFS.read(path);
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              const prefix = files.length > 1 ? `${colors.magenta}${file}${colors.reset}:` : '';
              const lineNum = showLineNum ? `${colors.green}${i + 1}${colors.reset}:` : '';
              const highlighted = lines[i].replace(regex, `${colors.red}${colors.bold}$&${colors.reset}`);
              results.push(`${prefix}${lineNum}${highlighted}`);
              regex.lastIndex = 0; // Reset for global regex
            }
          }
        } catch (e) {
          // Skip files that can't be read
        }
      }
      return results.join('\n');
    };

    commands.find = async (args) => {
      let path = '.';
      let namePattern = null;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-name' && args[i + 1]) {
          namePattern = args[++i];
        } else if (!args[i].startsWith('-')) {
          path = args[i];
        }
      }

      const searchPath = resolvePath(path);
      const prefix = searchPath === '/' ? '/' : searchPath + '/';
      const allFiles = await VFS.list('/');

      const results = [];
      for (const file of allFiles) {
        if (file.startsWith(prefix) || file === searchPath) {
          const filename = basename(file);
          if (!namePattern || matchGlob(filename, namePattern)) {
            results.push(file);
          }
        }
      }
      return results.join('\n');
    };

    // Simple glob matching
    const matchGlob = (str, pattern) => {
      const regex = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      return new RegExp(`^${regex}$`).test(str);
    };

    commands.env = async () => {
      return Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
    };

    commands.export = async (args) => {
      for (const arg of args) {
        const [key, ...rest] = arg.split('=');
        if (key && rest.length > 0) {
          env[key] = rest.join('=');
        }
      }
      return '';
    };

    commands.clear = async () => {
      Terminal.clear();
      return '';
    };

    // jq - JSON processor (simplified implementation without jq-web for now)
    commands.jq = async (args) => {
      let filter = '.';
      let files = [];
      let raw = false;
      let compact = false;

      for (const arg of args) {
        if (arg === '-r') raw = true;
        else if (arg === '-c') compact = true;
        else if (!arg.startsWith('-') && filter === '.') filter = arg;
        else if (!arg.startsWith('-')) files.push(arg);
      }

      // Read from files or use stdin-like behavior
      let input;
      if (files.length > 0) {
        const path = resolvePath(files[0]);
        try {
          input = await VFS.read(path);
        } catch (e) {
          throw new Error(`jq: ${files[0]}: No such file`);
        }
      } else {
        throw new Error('jq: requires input file');
      }

      try {
        const data = JSON.parse(input);
        let result = applyJqFilter(data, filter);

        if (raw && typeof result === 'string') {
          return result;
        }
        return compact ? JSON.stringify(result) : JSON.stringify(result, null, 2);
      } catch (e) {
        throw new Error(`jq: ${e.message}`);
      }
    };

    // Simple jq filter implementation
    const applyJqFilter = (data, filter) => {
      if (filter === '.') return data;

      // Handle .key access
      if (filter.startsWith('.')) {
        const parts = filter.slice(1).split('.');
        let result = data;
        for (const part of parts) {
          if (part === '') continue;

          // Handle array index [n]
          const arrayMatch = part.match(/^(\w*)\[(\d+)\]$/);
          if (arrayMatch) {
            const [, key, index] = arrayMatch;
            if (key) result = result[key];
            result = result[parseInt(index, 10)];
          }
          // Handle array iteration []
          else if (part.endsWith('[]')) {
            const key = part.slice(0, -2);
            if (key) result = result[key];
            if (!Array.isArray(result)) throw new Error('Cannot iterate over non-array');
          }
          // Handle keys
          else if (part === 'keys') {
            result = Object.keys(result);
          }
          // Handle length
          else if (part === 'length') {
            result = Array.isArray(result) ? result.length : Object.keys(result).length;
          }
          else {
            result = result[part];
          }

          if (result === undefined) return null;
        }
        return result;
      }

      // Handle select() - simplified
      if (filter.startsWith('select(')) {
        // Very basic select support
        return data;
      }

      return data;
    };

    // diff - compare two files
    commands.diff = async (args) => {
      let unified = false;
      const files = [];

      for (const arg of args) {
        if (arg === '-u') unified = true;
        else if (!arg.startsWith('-')) files.push(arg);
      }

      if (files.length < 2) {
        throw new Error('diff: requires two files');
      }

      const path1 = resolvePath(files[0]);
      const path2 = resolvePath(files[1]);

      let content1, content2;
      try {
        content1 = await VFS.read(path1);
      } catch (e) {
        throw new Error(`diff: ${files[0]}: No such file`);
      }
      try {
        content2 = await VFS.read(path2);
      } catch (e) {
        throw new Error(`diff: ${files[1]}: No such file`);
      }

      const lines1 = content1.split('\n');
      const lines2 = content2.split('\n');

      // Simple line-by-line diff
      const result = [];
      const maxLen = Math.max(lines1.length, lines2.length);

      if (unified) {
        result.push(`${colors.bold}--- ${files[0]}${colors.reset}`);
        result.push(`${colors.bold}+++ ${files[1]}${colors.reset}`);
      }

      for (let i = 0; i < maxLen; i++) {
        const line1 = lines1[i];
        const line2 = lines2[i];

        if (line1 === line2) {
          if (unified) result.push(` ${line1 || ''}`);
        } else if (line1 === undefined) {
          result.push(`${colors.green}+${line2}${colors.reset}`);
        } else if (line2 === undefined) {
          result.push(`${colors.red}-${line1}${colors.reset}`);
        } else {
          result.push(`${colors.red}-${line1}${colors.reset}`);
          result.push(`${colors.green}+${line2}${colors.reset}`);
        }
      }

      if (result.length === 0 || (unified && result.length === 2)) {
        return ''; // Files are identical
      }

      return result.join('\n');
    };

    // sed - stream editor (simplified)
    commands.sed = async (args) => {
      let inPlace = false;
      let expression = null;
      const files = [];

      for (const arg of args) {
        if (arg === '-i') inPlace = true;
        else if (!arg.startsWith('-') && !expression) expression = arg;
        else if (!arg.startsWith('-')) files.push(arg);
      }

      if (!expression) {
        throw new Error('sed: missing expression');
      }

      // Parse s/pattern/replacement/flags
      const match = expression.match(/^s\/(.+?)\/(.*)\/([gi]*)$/);
      if (!match) {
        throw new Error('sed: only s/pattern/replacement/flags supported');
      }

      const [, pattern, replacement, flags] = match;
      const regex = new RegExp(pattern, flags || 'g');

      const results = [];
      for (const file of files) {
        const path = resolvePath(file);
        try {
          const content = await VFS.read(path);
          const newContent = content.replace(regex, replacement);

          if (inPlace) {
            await VFS.write(path, newContent);
          } else {
            results.push(newContent);
          }
        } catch (e) {
          throw new Error(`sed: ${file}: No such file`);
        }
      }

      return inPlace ? '' : results.join('\n');
    };

    // curl/fetch - HTTP requests
    commands.curl = async (args) => {
      let method = 'GET';
      let headers = {};
      let data = null;
      let url = null;
      let silent = false;

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '-X' && args[i + 1]) {
          method = args[++i].toUpperCase();
        } else if (arg === '-H' && args[i + 1]) {
          const header = args[++i];
          const colonIdx = header.indexOf(':');
          if (colonIdx > 0) {
            headers[header.slice(0, colonIdx).trim()] = header.slice(colonIdx + 1).trim();
          }
        } else if ((arg === '-d' || arg === '--data') && args[i + 1]) {
          data = args[++i];
        } else if (arg === '-s' || arg === '--silent') {
          silent = true;
        } else if (!arg.startsWith('-')) {
          url = arg;
        }
      }

      if (!url) {
        throw new Error('curl: missing URL');
      }

      // Ensure URL has protocol
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      try {
        const options = {
          method,
          headers
        };

        if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
          options.body = data;
          if (!headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
          }
        }

        const response = await fetch(url, options);
        const text = await response.text();

        if (!silent && !response.ok) {
          return `${colors.red}HTTP ${response.status} ${response.statusText}${colors.reset}\n${text}`;
        }

        return text;
      } catch (e) {
        throw new Error(`curl: ${e.message}`);
      }
    };

    // Alias fetch to curl
    commands.fetch = commands.curl;

    // which - show command info
    commands.which = async (args) => {
      const results = [];
      for (const cmd of args) {
        if (commands[cmd]) {
          results.push(`${cmd}: built-in shell command`);
        } else {
          results.push(`${cmd}: not found`);
        }
      }
      return results.join('\n');
    };

    // date - print date/time
    commands.date = async () => {
      return new Date().toString();
    };

    // whoami - print current user
    commands.whoami = async () => {
      return env.USER;
    };

    // hostname - print hostname
    commands.hostname = async () => {
      return 'reploid-browser';
    };

    // git - version control (local only via isomorphic-git)
    commands.git = async (args) => {
      if (!GitTools) {
        throw new Error('git: GitTools not available');
      }

      const subcommand = args[0];
      const subargs = args.slice(1);

      switch (subcommand) {
        case 'init':
          return await GitTools.init(cwd);

        case 'status':
          return await GitTools.status(cwd);

        case 'add': {
          const file = subargs[0];
          if (!file) throw new Error('git add: missing file');
          if (file === '.') {
            // Add all files
            const allFiles = await VFS.list(cwd);
            for (const f of allFiles) {
              const relative = f.slice(cwd.length + (cwd === '/' ? 0 : 1));
              if (relative && !relative.startsWith('.git/')) {
                await GitTools.add(relative, cwd);
              }
            }
            return '';
          }
          return await GitTools.add(file, cwd);
        }

        case 'commit': {
          let message = '';
          for (let i = 0; i < subargs.length; i++) {
            if (subargs[i] === '-m' && subargs[i + 1]) {
              message = subargs[++i];
            }
          }
          if (!message) throw new Error('git commit: missing -m message');
          return await GitTools.commit(message, cwd);
        }

        case 'log': {
          let depth = 10;
          for (let i = 0; i < subargs.length; i++) {
            if (subargs[i] === '-n' && subargs[i + 1]) {
              depth = parseInt(subargs[++i], 10);
            }
          }
          return await GitTools.log(cwd, depth);
        }

        case 'branch': {
          const branchName = subargs[0];
          return await GitTools.branch(branchName, cwd);
        }

        case 'checkout': {
          const ref = subargs[0];
          if (!ref) throw new Error('git checkout: missing branch/ref');
          return await GitTools.checkout(ref, cwd);
        }

        case 'diff':
          return await GitTools.diff(cwd);

        default:
          return `git: '${subcommand}' is not a git command.

Available commands:
  git init           Initialize repository
  git status         Show working tree status
  git add <file>     Add file to staging
  git commit -m "msg" Create commit
  git log [-n N]     Show commit history
  git branch [name]  List or create branches
  git checkout <ref> Switch branches
  git diff           Show changes`;
      }
    };

    commands.help = async () => {
      return `${colors.cyan}${colors.bold}REPLOID Agent Tools${colors.reset} - Shell Commands

${colors.yellow}Navigation:${colors.reset}
  pwd              Print working directory
  cd <dir>         Change directory
  ls [-la] [dir]   List directory contents

${colors.yellow}File Operations:${colors.reset}
  cat <file>       Display file contents
  head [-n] <file> Show first lines of file
  tail [-n] <file> Show last lines of file
  touch <file>     Create empty file
  mkdir <dir>      Create directory
  rm [-rf] <file>  Remove file/directory
  cp <src> <dest>  Copy file
  mv <src> <dest>  Move/rename file
  diff [-u] <f1> <f2>  Compare two files

${colors.yellow}Search & Transform:${colors.reset}
  grep [-in] <pattern> [files]  Search for pattern
  find [path] -name <pattern>   Find files by name
  wc [-lwc] <file>              Count lines/words/bytes
  jq [-rc] <filter> <file>      Process JSON
  sed 's/pat/rep/g' <file>      Stream edit (regex replace)

${colors.yellow}Network:${colors.reset}
  curl [-X method] [-H header] [-d data] <url>  HTTP requests

${colors.yellow}Environment:${colors.reset}
  env              Show environment variables
  export KEY=val   Set environment variable
  echo <text>      Print text (supports $VAR)
  date             Show current date/time
  whoami           Show current user
  which <cmd>      Show command info

${colors.yellow}Git (local only):${colors.reset}
  git init         Initialize repository
  git status       Show working tree status
  git add <file>   Add file to staging (use . for all)
  git commit -m    Create commit with message
  git log [-n N]   Show commit history
  git branch       List or create branches
  git checkout     Switch branches
  git diff         Show uncommitted changes

${colors.yellow}Debug:${colors.reset}
  clear            Clear the screen
  help             Show this help`;
    };

    // --- Execute command ---

    const execute = async (line) => {
      const expanded = expandEnvVars(line);
      const tokens = parseCommand(expanded);

      if (tokens.length === 0) return '';

      const cmd = tokens[0];
      const args = tokens.slice(1);

      // Check for slash commands
      if (cmd.startsWith('/')) {
        EventBus.emit('cli:slash', { command: cmd, args });
        return '';
      }

      // Check for built-in commands
      if (commands[cmd]) {
        try {
          return await commands[cmd](args);
        } catch (e) {
          throw e;
        }
      }

      // Unknown command
      throw new Error(`${cmd}: command not found`);
    };

    const getCwd = () => cwd;
    const getEnv = () => ({ ...env });

    // --- Tab Completion ---

    const getCompletions = async (input, cursorPos) => {
      // Get the text up to cursor
      const textToCursor = input.slice(0, cursorPos);
      const tokens = parseCommand(textToCursor);

      // If no tokens or cursor is at the start, complete command names
      if (tokens.length === 0 || (tokens.length === 1 && !textToCursor.endsWith(' '))) {
        const partial = tokens[0] || '';
        return {
          type: 'command',
          partial,
          completions: getCommandCompletions(partial)
        };
      }

      // Otherwise, complete file paths
      const lastToken = textToCursor.endsWith(' ') ? '' : tokens[tokens.length - 1];
      const fileCompletions = await getFileCompletions(lastToken);

      return {
        type: 'file',
        partial: lastToken,
        completions: fileCompletions
      };
    };

    const getCommandCompletions = (partial) => {
      const cmdNames = Object.keys(commands);
      const slashCmds = ['/help', '/status', '/mode', '/model', '/verbose', '/compact', '/files', '/read', '/stop', '/history', '/clear', '/export'];
      const allCommands = [...cmdNames, ...slashCmds];

      if (!partial) return allCommands.slice(0, 20);

      const lower = partial.toLowerCase();
      return allCommands.filter(cmd => cmd.toLowerCase().startsWith(lower)).sort();
    };

    const getFileCompletions = async (partial) => {
      // Handle path prefixes
      let searchDir = cwd;
      let prefix = '';
      let searchPartial = partial;

      if (partial.includes('/')) {
        const lastSlash = partial.lastIndexOf('/');
        const pathPart = partial.slice(0, lastSlash + 1);
        searchPartial = partial.slice(lastSlash + 1);

        if (partial.startsWith('/')) {
          searchDir = pathPart === '/' ? '/' : pathPart.slice(0, -1);
          prefix = pathPart;
        } else {
          searchDir = resolvePath(pathPart);
          prefix = pathPart;
        }
      }

      // Get files in directory
      const allFiles = await VFS.list('/');
      const dirPrefix = searchDir === '/' ? '/' : searchDir + '/';

      const entries = new Set();
      for (const file of allFiles) {
        if (file.startsWith(dirPrefix)) {
          const relative = file.slice(dirPrefix.length);
          const firstPart = relative.split('/')[0];
          if (firstPart) {
            entries.add(firstPart);
          }
        }
      }

      // Filter by partial and add prefix
      const matches = [...entries]
        .filter(name => !searchPartial || name.toLowerCase().startsWith(searchPartial.toLowerCase()))
        .map(name => {
          // Check if it's a directory (has more files under it)
          const fullPath = dirPrefix + name;
          const isDir = allFiles.some(f => f.startsWith(fullPath + '/'));
          return prefix + name + (isDir ? '/' : '');
        })
        .sort();

      return matches;
    };

    const init = async () => {
      logger.info('[Shell] Ready');
      return true;
    };

    return {
      init,
      execute,
      getCwd,
      getEnv,
      resolvePath,
      getCompletions,
      commands
    };
  }
};

export default Shell;
