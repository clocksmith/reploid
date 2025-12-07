/**
 * @fileoverview Command Palette
 * Quick access to actions via keyboard shortcut (Ctrl/Cmd + K)
 */

const CommandPalette = {
  _overlay: null,
  _input: null,
  _list: null,
  _commands: [],
  _filteredCommands: [],
  _selectedIndex: 0,
  _isOpen: false,
  _callbacks: {},

  init(callbacks = {}) {
    this._callbacks = callbacks;
    this._setupCommands();
    this._setupKeyboardShortcuts();
  },

  _setupCommands() {
    this._commands = [
      { id: 'stop', icon: '■', label: 'Stop Agent', shortcut: 'Esc', action: () => this._callbacks.onStop?.() },
      { id: 'resume', icon: '▶', label: 'Resume Agent', shortcut: 'Ctrl+Enter', action: () => this._callbacks.onResume?.() },
      { id: 'export', icon: '↓', label: 'Export State', shortcut: 'Ctrl+E', action: () => this._callbacks.onExport?.() },
      { id: 'clear', icon: '⌫', label: 'Clear History', action: () => this._callbacks.onClearHistory?.() },
      { id: 'refresh-vfs', icon: '↻', label: 'Refresh VFS', action: () => this._callbacks.onRefreshVFS?.() },
      { id: 'tab-history', icon: '▶', label: 'Show History Tab', shortcut: '1', action: () => this._callbacks.onSwitchTab?.('history') },
      { id: 'tab-reflections', icon: '✱', label: 'Show Reflections Tab', shortcut: '2', action: () => this._callbacks.onSwitchTab?.('reflections') },
      { id: 'tab-status', icon: 'ℹ', label: 'Show Status Tab', shortcut: '3', action: () => this._callbacks.onSwitchTab?.('status') },
      { id: 'tab-telemetry', icon: '☡', label: 'Show Telemetry Tab', shortcut: '4', action: () => this._callbacks.onSwitchTab?.('telemetry') },
      { id: 'tab-schemas', icon: '☰', label: 'Show Schema Registry', shortcut: '5', action: () => this._callbacks.onSwitchTab?.('schemas') },
      { id: 'tab-workers', icon: '⚒', label: 'Show Workers Tab', action: () => this._callbacks.onSwitchTab?.('workers') },
      { id: 'tab-debug', icon: '⚙', label: 'Show Debug Tab', action: () => this._callbacks.onSwitchTab?.('debug') },
      { id: 'back-boot', icon: '←', label: 'Back to Boot Screen', action: () => location.reload() },
      { id: 'toggle-vfs', icon: '◫', label: 'Toggle VFS Panel', action: () => this._callbacks.onToggleVFS?.() },
    ];
    this._filteredCommands = [...this._commands];
  },

  _setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Cmd/Ctrl + K to open palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        this.toggle();
        return;
      }

      // Escape to close palette or stop agent
      if (e.key === 'Escape') {
        if (this._isOpen) {
          this.close();
        } else {
          this._callbacks.onStop?.();
        }
        return;
      }

      // Don't handle shortcuts if palette is open or input is focused
      if (this._isOpen || document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      // Ctrl/Cmd + Enter to resume
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        this._callbacks.onResume?.();
        return;
      }

      // Ctrl/Cmd + E to export
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        this._callbacks.onExport?.();
        return;
      }

      // Number keys for tab switching (when not typing)
      if (['1', '2', '3', '4', '5'].includes(e.key)) {
        const tabs = ['history', 'reflections', 'status', 'telemetry', 'schemas'];
        const index = parseInt(e.key, 10) - 1;
        this._callbacks.onSwitchTab?.(tabs[index]);
        return;
      }
    });
  },

  _createOverlay() {
    if (this._overlay) return;

    this._overlay = document.createElement('div');
    this._overlay.className = 'command-palette-overlay hidden';
    this._overlay.innerHTML = `
      <div class="command-palette">
        <input type="text" class="command-palette-input" placeholder="Type a command..." autocomplete="off" />
        <div class="command-palette-list"></div>
      </div>
    `;

    this._input = this._overlay.querySelector('.command-palette-input');
    this._list = this._overlay.querySelector('.command-palette-list');

    // Close on overlay click
    this._overlay.addEventListener('click', (e) => {
      if (e.target === this._overlay) {
        this.close();
      }
    });

    // Input handling
    this._input.addEventListener('input', () => this._filter());
    this._input.addEventListener('keydown', (e) => this._handleInputKeydown(e));

    document.body.appendChild(this._overlay);
  },

  _handleInputKeydown(e) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this._selectedIndex = Math.min(this._selectedIndex + 1, this._filteredCommands.length - 1);
        this._renderList();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._selectedIndex = Math.max(this._selectedIndex - 1, 0);
        this._renderList();
        break;
      case 'Enter':
        e.preventDefault();
        if (this._filteredCommands[this._selectedIndex]) {
          this._executeCommand(this._filteredCommands[this._selectedIndex]);
        }
        break;
      case 'Escape':
        this.close();
        break;
    }
  },

  _filter() {
    const query = this._input.value.toLowerCase().trim();
    if (!query) {
      this._filteredCommands = [...this._commands];
    } else {
      this._filteredCommands = this._commands.filter(cmd =>
        cmd.label.toLowerCase().includes(query) ||
        cmd.id.toLowerCase().includes(query)
      );
    }
    this._selectedIndex = 0;
    this._renderList();
  },

  _renderList() {
    if (this._filteredCommands.length === 0) {
      this._list.innerHTML = '<div class="command-palette-empty">No commands found</div>';
      return;
    }

    this._list.innerHTML = this._filteredCommands.map((cmd, index) => `
      <div class="command-palette-item ${index === this._selectedIndex ? 'selected' : ''}" data-index="${index}">
        <span class="command-palette-icon">${cmd.icon}</span>
        <span class="command-palette-label">${cmd.label}</span>
        ${cmd.shortcut ? `<span class="command-palette-shortcut">${cmd.shortcut}</span>` : ''}
      </div>
    `).join('');

    // Click handlers
    this._list.querySelectorAll('.command-palette-item').forEach((item, index) => {
      item.addEventListener('click', () => {
        this._executeCommand(this._filteredCommands[index]);
      });
    });

    // Scroll selected into view
    const selected = this._list.querySelector('.selected');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  },

  _executeCommand(cmd) {
    this.close();
    if (cmd.action) {
      cmd.action();
    }
  },

  open() {
    this._createOverlay();
    this._overlay.classList.remove('hidden');
    this._isOpen = true;
    this._input.value = '';
    this._filter();
    this._input.focus();
  },

  close() {
    if (this._overlay) {
      this._overlay.classList.add('hidden');
    }
    this._isOpen = false;
  },

  toggle() {
    if (this._isOpen) {
      this.close();
    } else {
      this.open();
    }
  },

  isOpen() {
    return this._isOpen;
  }
};

export default CommandPalette;
