/**
 * @fileoverview Unit tests for Command Palette
 * Tests keyboard shortcuts, command filtering, selection, and execution
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('CommandPalette', () => {
  let CommandPalette;
  let callbacks;

  beforeEach(async () => {
    // Clear DOM
    document.body.innerHTML = '';

    // Reset module cache
    vi.resetModules();

    // Import fresh CommandPalette
    const module = await import('../../ui/command-palette.js');
    CommandPalette = module.default;

    // Reset internal state
    CommandPalette._overlay = null;
    CommandPalette._input = null;
    CommandPalette._list = null;
    CommandPalette._isOpen = false;
    CommandPalette._selectedIndex = 0;

    // Setup mock callbacks
    callbacks = {
      onStop: vi.fn(),
      onResume: vi.fn(),
      onExport: vi.fn(),
      onClearHistory: vi.fn(),
      onRefreshVFS: vi.fn(),
      onSwitchTab: vi.fn(),
      onToggleVFS: vi.fn()
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  describe('init', () => {
    it('should set up callbacks', () => {
      CommandPalette.init(callbacks);
      expect(CommandPalette._callbacks).toBe(callbacks);
    });

    it('should set up default commands', () => {
      CommandPalette.init(callbacks);

      expect(CommandPalette._commands.length).toBeGreaterThan(0);
      expect(CommandPalette._commands.find(c => c.id === 'stop')).toBeDefined();
      expect(CommandPalette._commands.find(c => c.id === 'resume')).toBeDefined();
      expect(CommandPalette._commands.find(c => c.id === 'export')).toBeDefined();
    });
  });

  describe('keyboard shortcuts', () => {
    beforeEach(() => {
      CommandPalette.init(callbacks);
    });

    it('should open palette on Ctrl+K', () => {
      const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
      document.dispatchEvent(event);

      expect(CommandPalette._isOpen).toBe(true);
    });

    it('should open palette on Cmd+K (Mac)', () => {
      const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
      document.dispatchEvent(event);

      expect(CommandPalette._isOpen).toBe(true);
    });

    it('should close palette on Escape when open', () => {
      CommandPalette.open();
      expect(CommandPalette._isOpen).toBe(true);

      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);

      expect(CommandPalette._isOpen).toBe(false);
    });

    it('should call onStop on Escape when palette is closed', () => {
      expect(CommandPalette._isOpen).toBe(false);

      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);

      expect(callbacks.onStop).toHaveBeenCalled();
    });

    it('should call onResume on Ctrl+Enter', () => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true });
      document.dispatchEvent(event);

      expect(callbacks.onResume).toHaveBeenCalled();
    });

    it('should call onExport on Ctrl+E', () => {
      const event = new KeyboardEvent('keydown', { key: 'e', ctrlKey: true });
      document.dispatchEvent(event);

      expect(callbacks.onExport).toHaveBeenCalled();
    });

    it('should switch tabs on number keys', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
      expect(callbacks.onSwitchTab).toHaveBeenCalledWith('history');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
      expect(callbacks.onSwitchTab).toHaveBeenCalledWith('reflections');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
      expect(callbacks.onSwitchTab).toHaveBeenCalledWith('status');
    });

    it('should not handle shortcuts when input is focused', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
      expect(callbacks.onSwitchTab).not.toHaveBeenCalled();

      input.remove();
    });

    it('should not handle shortcuts when textarea is focused', () => {
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      textarea.focus();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
      expect(callbacks.onSwitchTab).not.toHaveBeenCalled();

      textarea.remove();
    });
  });

  describe('open/close/toggle', () => {
    beforeEach(() => {
      CommandPalette.init(callbacks);
    });

    it('should create overlay on first open', () => {
      expect(document.querySelector('.command-palette-overlay')).toBeNull();

      CommandPalette.open();

      expect(document.querySelector('.command-palette-overlay')).not.toBeNull();
    });

    it('should show overlay when opened', () => {
      CommandPalette.open();

      const overlay = document.querySelector('.command-palette-overlay');
      expect(overlay.classList.contains('hidden')).toBe(false);
    });

    it('should hide overlay when closed', () => {
      CommandPalette.open();
      CommandPalette.close();

      const overlay = document.querySelector('.command-palette-overlay');
      expect(overlay.classList.contains('hidden')).toBe(true);
    });

    it('should toggle between open and closed', () => {
      CommandPalette.toggle();
      expect(CommandPalette._isOpen).toBe(true);

      CommandPalette.toggle();
      expect(CommandPalette._isOpen).toBe(false);

      CommandPalette.toggle();
      expect(CommandPalette._isOpen).toBe(true);
    });

    it('should focus input when opened', () => {
      CommandPalette.open();

      const input = document.querySelector('.command-palette-input');
      expect(document.activeElement).toBe(input);
    });

    it('should clear input when opened', () => {
      CommandPalette.open();
      const input = document.querySelector('.command-palette-input');
      input.value = 'previous search';

      CommandPalette.close();
      CommandPalette.open();

      expect(input.value).toBe('');
    });

    it('should report isOpen state correctly', () => {
      expect(CommandPalette.isOpen()).toBe(false);

      CommandPalette.open();
      expect(CommandPalette.isOpen()).toBe(true);

      CommandPalette.close();
      expect(CommandPalette.isOpen()).toBe(false);
    });
  });

  describe('filtering', () => {
    beforeEach(() => {
      CommandPalette.init(callbacks);
      CommandPalette.open();
    });

    it('should show all commands when filter is empty', () => {
      const items = document.querySelectorAll('.command-palette-item');
      expect(items.length).toBe(CommandPalette._commands.length);
    });

    it('should filter commands by label', () => {
      const input = document.querySelector('.command-palette-input');
      input.value = 'stop';
      input.dispatchEvent(new Event('input'));

      const items = document.querySelectorAll('.command-palette-item');
      expect(items.length).toBe(1);
      expect(items[0].querySelector('.command-palette-label').textContent).toBe('Stop Agent');
    });

    it('should filter commands by id', () => {
      const input = document.querySelector('.command-palette-input');
      input.value = 'refresh';
      input.dispatchEvent(new Event('input'));

      const items = document.querySelectorAll('.command-palette-item');
      expect(items.length).toBe(1);
    });

    it('should be case-insensitive', () => {
      const input = document.querySelector('.command-palette-input');
      input.value = 'STOP';
      input.dispatchEvent(new Event('input'));

      const items = document.querySelectorAll('.command-palette-item');
      expect(items.length).toBe(1);
    });

    it('should show empty message when no commands match', () => {
      const input = document.querySelector('.command-palette-input');
      input.value = 'xyz123nonexistent';
      input.dispatchEvent(new Event('input'));

      const empty = document.querySelector('.command-palette-empty');
      expect(empty).not.toBeNull();
      expect(empty.textContent).toBe('No commands found');
    });

    it('should reset selection index when filtering', () => {
      CommandPalette._selectedIndex = 3;

      const input = document.querySelector('.command-palette-input');
      input.value = 'stop';
      input.dispatchEvent(new Event('input'));

      expect(CommandPalette._selectedIndex).toBe(0);
    });
  });

  describe('keyboard navigation', () => {
    beforeEach(() => {
      CommandPalette.init(callbacks);
      CommandPalette.open();
    });

    it('should move selection down with ArrowDown', () => {
      const input = document.querySelector('.command-palette-input');

      expect(CommandPalette._selectedIndex).toBe(0);

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      expect(CommandPalette._selectedIndex).toBe(1);

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      expect(CommandPalette._selectedIndex).toBe(2);
    });

    it('should move selection up with ArrowUp', () => {
      const input = document.querySelector('.command-palette-input');
      CommandPalette._selectedIndex = 2;

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      expect(CommandPalette._selectedIndex).toBe(1);

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      expect(CommandPalette._selectedIndex).toBe(0);
    });

    it('should not go below 0 with ArrowUp', () => {
      const input = document.querySelector('.command-palette-input');
      CommandPalette._selectedIndex = 0;

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      expect(CommandPalette._selectedIndex).toBe(0);
    });

    it('should not exceed list length with ArrowDown', () => {
      const input = document.querySelector('.command-palette-input');
      const maxIndex = CommandPalette._filteredCommands.length - 1;
      CommandPalette._selectedIndex = maxIndex;

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      expect(CommandPalette._selectedIndex).toBe(maxIndex);
    });

    it('should highlight selected item', () => {
      const input = document.querySelector('.command-palette-input');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      const items = document.querySelectorAll('.command-palette-item');
      expect(items[0].classList.contains('selected')).toBe(false);
      expect(items[1].classList.contains('selected')).toBe(true);
    });

    it('should execute selected command on Enter', () => {
      const input = document.querySelector('.command-palette-input');

      // Filter to just 'stop' command
      input.value = 'stop';
      input.dispatchEvent(new Event('input'));

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(callbacks.onStop).toHaveBeenCalled();
      expect(CommandPalette._isOpen).toBe(false);
    });

    it('should close palette on Escape', () => {
      const input = document.querySelector('.command-palette-input');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(CommandPalette._isOpen).toBe(false);
    });
  });

  describe('command execution', () => {
    beforeEach(() => {
      CommandPalette.init(callbacks);
      CommandPalette.open();
    });

    it('should execute command on click', () => {
      const input = document.querySelector('.command-palette-input');
      input.value = 'export';
      input.dispatchEvent(new Event('input'));

      const item = document.querySelector('.command-palette-item');
      item.click();

      expect(callbacks.onExport).toHaveBeenCalled();
    });

    it('should close palette after executing command', () => {
      const item = document.querySelector('.command-palette-item');
      item.click();

      expect(CommandPalette._isOpen).toBe(false);
    });

    it('should execute correct command callbacks', () => {
      const commandTests = [
        { filter: 'stop', callback: 'onStop' },
        { filter: 'resume', callback: 'onResume' },
        { filter: 'export', callback: 'onExport' },
        { filter: 'clear', callback: 'onClearHistory' },
        { filter: 'refresh', callback: 'onRefreshVFS' },
        { filter: 'toggle vfs', callback: 'onToggleVFS' }
      ];

      commandTests.forEach(({ filter, callback }) => {
        vi.clearAllMocks();
        CommandPalette.open();

        const input = document.querySelector('.command-palette-input');
        input.value = filter;
        input.dispatchEvent(new Event('input'));

        const item = document.querySelector('.command-palette-item');
        if (item) {
          item.click();
          expect(callbacks[callback]).toHaveBeenCalled();
        }
      });
    });

    it('should handle tab switching commands', () => {
      CommandPalette.open();

      const input = document.querySelector('.command-palette-input');
      input.value = 'history tab';
      input.dispatchEvent(new Event('input'));

      const item = document.querySelector('.command-palette-item');
      if (item) {
        item.click();
        expect(callbacks.onSwitchTab).toHaveBeenCalledWith('history');
      }
    });
  });

  describe('overlay interaction', () => {
    beforeEach(() => {
      CommandPalette.init(callbacks);
    });

    it('should close on overlay click', () => {
      CommandPalette.open();

      const overlay = document.querySelector('.command-palette-overlay');
      overlay.click();

      expect(CommandPalette._isOpen).toBe(false);
    });

    it('should not close when clicking inside palette', () => {
      CommandPalette.open();

      const palette = document.querySelector('.command-palette');
      palette.click();

      // Should still be open since we clicked inside
      expect(CommandPalette._isOpen).toBe(true);
    });
  });

  describe('command display', () => {
    beforeEach(() => {
      CommandPalette.init(callbacks);
      CommandPalette.open();
    });

    it('should display command icons', () => {
      const items = document.querySelectorAll('.command-palette-item');
      const icons = document.querySelectorAll('.command-palette-icon');

      expect(icons.length).toBe(items.length);
      icons.forEach(icon => {
        expect(icon.textContent.length).toBeGreaterThan(0);
      });
    });

    it('should display command labels', () => {
      const labels = document.querySelectorAll('.command-palette-label');

      labels.forEach(label => {
        expect(label.textContent.length).toBeGreaterThan(0);
      });
    });

    it('should display shortcuts where available', () => {
      const shortcuts = document.querySelectorAll('.command-palette-shortcut');

      // At least some commands have shortcuts
      expect(shortcuts.length).toBeGreaterThan(0);
    });
  });
});
