/**
 * @fileoverview Unit tests for Goal History Manager
 * Tests localStorage persistence, history management, and dropdown UI
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('GoalHistory', () => {
  let GoalHistory;
  let mockLocalStorage;

  beforeEach(async () => {
    // Clear DOM
    document.body.innerHTML = '';

    // Mock localStorage
    mockLocalStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key) => mockLocalStorage[key] || null),
      setItem: vi.fn((key, value) => { mockLocalStorage[key] = value; }),
      removeItem: vi.fn((key) => { delete mockLocalStorage[key]; })
    });

    // Reset module cache
    vi.resetModules();

    // Import fresh GoalHistory
    const module = await import('../../ui/goal-history.js');
    GoalHistory = module.default;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('_getHistory', () => {
    it('should return empty array if no history stored', () => {
      const history = GoalHistory._getHistory();
      expect(history).toEqual([]);
    });

    it('should parse and return stored history', () => {
      mockLocalStorage[GoalHistory.STORAGE_KEY] = JSON.stringify([
        { text: 'Goal 1', timestamp: 1000 }
      ]);

      const history = GoalHistory._getHistory();
      expect(history).toEqual([{ text: 'Goal 1', timestamp: 1000 }]);
    });

    it('should return empty array on parse error', () => {
      mockLocalStorage[GoalHistory.STORAGE_KEY] = 'invalid json';

      const history = GoalHistory._getHistory();
      expect(history).toEqual([]);
    });
  });

  describe('_saveHistory', () => {
    it('should save history to localStorage', () => {
      const history = [{ text: 'Test', timestamp: 1000 }];
      GoalHistory._saveHistory(history);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        GoalHistory.STORAGE_KEY,
        JSON.stringify(history)
      );
    });
  });

  describe('add', () => {
    it('should add goal to history', () => {
      GoalHistory.add('Build a web app');

      const history = JSON.parse(mockLocalStorage[GoalHistory.STORAGE_KEY]);
      expect(history[0].text).toBe('Build a web app');
      expect(history[0].timestamp).toBeDefined();
    });

    it('should trim whitespace from goal', () => {
      GoalHistory.add('  Goal with spaces  ');

      const history = JSON.parse(mockLocalStorage[GoalHistory.STORAGE_KEY]);
      expect(history[0].text).toBe('Goal with spaces');
    });

    it('should not add empty goals', () => {
      GoalHistory.add('');
      GoalHistory.add('   ');
      GoalHistory.add(null);
      GoalHistory.add(undefined);

      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('should not add non-string goals', () => {
      GoalHistory.add(123);
      GoalHistory.add({});
      GoalHistory.add([]);

      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('should add new goals at the beginning', () => {
      GoalHistory.add('First goal');
      GoalHistory.add('Second goal');
      GoalHistory.add('Third goal');

      const history = JSON.parse(mockLocalStorage[GoalHistory.STORAGE_KEY]);
      expect(history[0].text).toBe('Third goal');
      expect(history[1].text).toBe('Second goal');
      expect(history[2].text).toBe('First goal');
    });

    it('should move existing goal to top instead of duplicating', () => {
      GoalHistory.add('First goal');
      GoalHistory.add('Second goal');
      GoalHistory.add('First goal'); // Add again

      const history = JSON.parse(mockLocalStorage[GoalHistory.STORAGE_KEY]);
      expect(history.length).toBe(2);
      expect(history[0].text).toBe('First goal');
      expect(history[1].text).toBe('Second goal');
    });

    it('should limit history to MAX_HISTORY entries', () => {
      for (let i = 0; i < 15; i++) {
        GoalHistory.add(`Goal ${i}`);
      }

      const history = JSON.parse(mockLocalStorage[GoalHistory.STORAGE_KEY]);
      expect(history.length).toBe(GoalHistory.MAX_HISTORY);
      expect(history[0].text).toBe('Goal 14');
    });
  });

  describe('getAll', () => {
    it('should return all history entries', () => {
      GoalHistory.add('Goal 1');
      GoalHistory.add('Goal 2');

      const history = GoalHistory.getAll();
      expect(history.length).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove history from localStorage', () => {
      GoalHistory.add('Some goal');
      GoalHistory.clear();

      expect(localStorage.removeItem).toHaveBeenCalledWith(GoalHistory.STORAGE_KEY);
    });
  });

  describe('formatTime', () => {
    it('should format recent time as "Just now"', () => {
      const now = Date.now();
      expect(GoalHistory.formatTime(now - 30000)).toBe('Just now');
    });

    it('should format minutes correctly', () => {
      const now = Date.now();
      expect(GoalHistory.formatTime(now - 60000 * 5)).toBe('5m ago');
      expect(GoalHistory.formatTime(now - 60000 * 30)).toBe('30m ago');
    });

    it('should format hours correctly', () => {
      const now = Date.now();
      expect(GoalHistory.formatTime(now - 3600000 * 2)).toBe('2h ago');
      expect(GoalHistory.formatTime(now - 3600000 * 12)).toBe('12h ago');
    });

    it('should format days correctly', () => {
      const now = Date.now();
      expect(GoalHistory.formatTime(now - 86400000 * 2)).toBe('2d ago');
      expect(GoalHistory.formatTime(now - 86400000 * 5)).toBe('5d ago');
    });

    it('should format older dates as locale date string', () => {
      const now = Date.now();
      const oldTimestamp = now - 86400000 * 14; // 14 days ago

      const result = GoalHistory.formatTime(oldTimestamp);
      expect(result).not.toContain('ago');
      // Should be a date string like "1/1/2024"
      expect(result).toMatch(/\d/);
    });
  });

  describe('initDropdown', () => {
    let inputElement;
    let onSelectCallback;

    beforeEach(() => {
      // Create container and input
      const container = document.createElement('div');
      inputElement = document.createElement('input');
      container.appendChild(inputElement);
      document.body.appendChild(container);

      onSelectCallback = vi.fn();
    });

    it('should return null if no input element provided', () => {
      const result = GoalHistory.initDropdown(null, onSelectCallback);
      expect(result).toBeUndefined();
    });

    it('should wrap input in container', () => {
      GoalHistory.initDropdown(inputElement, onSelectCallback);

      expect(inputElement.parentElement.classList.contains('goal-history-container')).toBe(true);
    });

    it('should create dropdown element', () => {
      GoalHistory.initDropdown(inputElement, onSelectCallback);

      const dropdown = document.querySelector('.goal-history-dropdown');
      expect(dropdown).not.toBeNull();
      expect(dropdown.classList.contains('hidden')).toBe(true);
    });

    it('should return control functions', () => {
      const controls = GoalHistory.initDropdown(inputElement, onSelectCallback);

      expect(controls.openDropdown).toBeInstanceOf(Function);
      expect(controls.closeDropdown).toBeInstanceOf(Function);
      expect(controls.renderDropdown).toBeInstanceOf(Function);
    });

    it('should open dropdown on focus when input is empty', () => {
      GoalHistory.initDropdown(inputElement, onSelectCallback);

      inputElement.dispatchEvent(new FocusEvent('focus'));

      const dropdown = document.querySelector('.goal-history-dropdown');
      expect(dropdown.classList.contains('hidden')).toBe(false);
    });

    it('should not open dropdown on focus when input has value', () => {
      GoalHistory.initDropdown(inputElement, onSelectCallback);
      inputElement.value = 'some text';

      inputElement.dispatchEvent(new FocusEvent('focus'));

      const dropdown = document.querySelector('.goal-history-dropdown');
      expect(dropdown.classList.contains('hidden')).toBe(true);
    });

    it('should close dropdown on blur', async () => {
      vi.useFakeTimers();

      GoalHistory.initDropdown(inputElement, onSelectCallback);
      inputElement.dispatchEvent(new FocusEvent('focus'));

      inputElement.dispatchEvent(new FocusEvent('blur'));
      vi.advanceTimersByTime(300);

      const dropdown = document.querySelector('.goal-history-dropdown');
      expect(dropdown.classList.contains('hidden')).toBe(true);

      vi.useRealTimers();
    });

    it('should close dropdown when typing', () => {
      GoalHistory.initDropdown(inputElement, onSelectCallback);
      inputElement.dispatchEvent(new FocusEvent('focus'));

      inputElement.value = 'typing';
      inputElement.dispatchEvent(new Event('input'));

      const dropdown = document.querySelector('.goal-history-dropdown');
      expect(dropdown.classList.contains('hidden')).toBe(true);
    });

    it('should reopen dropdown when clearing input', () => {
      GoalHistory.initDropdown(inputElement, onSelectCallback);
      inputElement.value = 'typing';
      inputElement.dispatchEvent(new FocusEvent('focus'));

      inputElement.value = '';
      inputElement.dispatchEvent(new Event('input'));

      const dropdown = document.querySelector('.goal-history-dropdown');
      expect(dropdown.classList.contains('hidden')).toBe(false);
    });

    it('should show empty message when no history', () => {
      GoalHistory.initDropdown(inputElement, onSelectCallback);
      inputElement.dispatchEvent(new FocusEvent('focus'));

      const empty = document.querySelector('.goal-history-empty');
      expect(empty).not.toBeNull();
      expect(empty.textContent).toBe('No recent goals');
    });

    it('should render history items', () => {
      GoalHistory.add('Goal 1');
      GoalHistory.add('Goal 2');

      GoalHistory.initDropdown(inputElement, onSelectCallback);
      inputElement.dispatchEvent(new FocusEvent('focus'));

      const items = document.querySelectorAll('.goal-history-item');
      expect(items.length).toBe(2);
    });

    it('should display goal text and time', () => {
      GoalHistory.add('My test goal');

      GoalHistory.initDropdown(inputElement, onSelectCallback);
      inputElement.dispatchEvent(new FocusEvent('focus'));

      const item = document.querySelector('.goal-history-item');
      expect(item.querySelector('.goal-history-text').textContent).toBe('My test goal');
      expect(item.querySelector('.goal-history-time').textContent).toBe('Just now');
    });

    it('should call onSelect when item is clicked', () => {
      GoalHistory.add('Clickable goal');

      GoalHistory.initDropdown(inputElement, onSelectCallback);
      inputElement.dispatchEvent(new FocusEvent('focus'));

      const item = document.querySelector('.goal-history-item');
      item.click();

      expect(onSelectCallback).toHaveBeenCalledWith('Clickable goal');
    });

    it('should close dropdown after selection', () => {
      GoalHistory.add('Goal');

      GoalHistory.initDropdown(inputElement, onSelectCallback);
      inputElement.dispatchEvent(new FocusEvent('focus'));

      const item = document.querySelector('.goal-history-item');
      item.click();

      const dropdown = document.querySelector('.goal-history-dropdown');
      expect(dropdown.classList.contains('hidden')).toBe(true);
    });
  });

  describe('keyboard navigation in dropdown', () => {
    let inputElement;
    let onSelectCallback;

    beforeEach(() => {
      const container = document.createElement('div');
      inputElement = document.createElement('input');
      container.appendChild(inputElement);
      document.body.appendChild(container);

      onSelectCallback = vi.fn();

      GoalHistory.add('Goal 1');
      GoalHistory.add('Goal 2');
      GoalHistory.add('Goal 3');

      GoalHistory.initDropdown(inputElement, onSelectCallback);
      inputElement.dispatchEvent(new FocusEvent('focus'));
    });

    it('should navigate down with ArrowDown', () => {
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      const items = document.querySelectorAll('.goal-history-item');
      expect(items[0].classList.contains('hover')).toBe(true);
    });

    it('should navigate up with ArrowUp', () => {
      // Navigate down first
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      // Then up
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

      const items = document.querySelectorAll('.goal-history-item');
      expect(items[0].classList.contains('hover')).toBe(true);
    });

    it('should wrap around at end with ArrowDown', () => {
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      const items = document.querySelectorAll('.goal-history-item');
      expect(items[0].classList.contains('hover')).toBe(true);
    });

    it('should wrap around at beginning with ArrowUp', () => {
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

      const items = document.querySelectorAll('.goal-history-item');
      expect(items[items.length - 1].classList.contains('hover')).toBe(true);
    });

    it('should select item on Enter', () => {
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(onSelectCallback).toHaveBeenCalledWith('Goal 3');
    });

    it('should not select on Enter without navigation', () => {
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(onSelectCallback).not.toHaveBeenCalled();
    });
  });

  describe('_escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(GoalHistory._escapeHtml('<script>')).toBe('&lt;script&gt;');
      expect(GoalHistory._escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('should handle safe text unchanged', () => {
      expect(GoalHistory._escapeHtml('Hello World')).toBe('Hello World');
    });
  });

  describe('STORAGE_KEY constant', () => {
    it('should have correct storage key', () => {
      expect(GoalHistory.STORAGE_KEY).toBe('REPLOID_GOAL_HISTORY');
    });
  });

  describe('MAX_HISTORY constant', () => {
    it('should have correct max history value', () => {
      expect(GoalHistory.MAX_HISTORY).toBe(10);
    });
  });
});
