/**
 * @fileoverview Unit tests for Toast Notification System
 * Tests toast creation, dismissal, and actions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to mock the DOM environment before importing Toast
// Since Toast adds styles on import, we need to handle that

describe('Toast', () => {
  let Toast;

  beforeEach(async () => {
    // Clear any existing Toast state
    document.body.innerHTML = '';
    document.head.innerHTML = '';

    // Reset module cache to get fresh Toast instance
    vi.resetModules();

    // Import fresh Toast
    const module = await import('../../ui/toast.js');
    Toast = module.default;

    // Reset internal state
    Toast._container = null;
    Toast._toasts = new Map();
    Toast._idCounter = 0;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllTimers();
  });

  describe('init', () => {
    it('should create container element on first init', () => {
      Toast.init();

      const container = document.querySelector('.toast-container');
      expect(container).not.toBeNull();
      expect(container.getAttribute('role')).toBe('alert');
      expect(container.getAttribute('aria-live')).toBe('polite');
    });

    it('should not create duplicate containers on multiple init calls', () => {
      Toast.init();
      Toast.init();
      Toast.init();

      const containers = document.querySelectorAll('.toast-container');
      expect(containers.length).toBe(1);
    });
  });

  describe('show', () => {
    it('should create toast element with correct type class', () => {
      const id = Toast.show({ type: 'success', title: 'Test' });

      const toast = document.getElementById(id);
      expect(toast).not.toBeNull();
      expect(toast.classList.contains('toast-success')).toBe(true);
    });

    it('should create toast with title and message', () => {
      const id = Toast.show({ title: 'My Title', message: 'My message' });

      const toast = document.getElementById(id);
      expect(toast.querySelector('.toast-title').textContent).toBe('My Title');
      expect(toast.querySelector('.toast-message').textContent).toBe('My message');
    });

    it('should display correct icon for each type', () => {
      // Only info and success types show popup toasts now
      // Warning/error moved to ErrorStore (no popup)
      const types = ['info', 'success'];
      const expectedIcons = { info: '☛', success: '✓' };

      types.forEach(type => {
        const id = Toast.show({ type, title: type });
        const toast = document.getElementById(id);
        const icon = toast.querySelector('.toast-icon').textContent;
        expect(icon).toBe(expectedIcons[type]);
      });
    });

    it('should return unique IDs for each toast', () => {
      const id1 = Toast.show({ title: 'First' });
      const id2 = Toast.show({ title: 'Second' });
      const id3 = Toast.show({ title: 'Third' });

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it('should auto-dismiss after duration', async () => {
      vi.useFakeTimers();

      const id = Toast.show({ title: 'Test', duration: 1000 });

      expect(document.getElementById(id)).not.toBeNull();

      vi.advanceTimersByTime(1200);

      // Allow animation timeout to complete
      vi.advanceTimersByTime(300);

      expect(Toast._toasts.has(id)).toBe(false);

      vi.useRealTimers();
    });

    it('should not auto-dismiss when duration is 0', async () => {
      vi.useFakeTimers();

      const id = Toast.show({ title: 'Test', duration: 0 });

      vi.advanceTimersByTime(10000);

      expect(document.getElementById(id)).not.toBeNull();
      expect(Toast._toasts.has(id)).toBe(true);

      vi.useRealTimers();
    });

    it('should render action buttons when provided', () => {
      const id = Toast.show({
        title: 'Test',
        actions: [
          { label: 'Retry', onClick: vi.fn() },
          { label: 'Cancel', onClick: vi.fn(), primary: true }
        ]
      });

      const toast = document.getElementById(id);
      const buttons = toast.querySelectorAll('.toast-btn');

      expect(buttons.length).toBe(2);
      expect(buttons[0].textContent.trim()).toBe('Retry');
      expect(buttons[1].textContent.trim()).toBe('Cancel');
      expect(buttons[1].classList.contains('primary')).toBe(true);
    });

    it('should call action onClick and dismiss toast when action button clicked', () => {
      vi.useFakeTimers();

      const onClick = vi.fn();
      const id = Toast.show({
        title: 'Test',
        duration: 0,
        actions: [{ label: 'Click Me', onClick }]
      });

      const button = document.querySelector(`#${id} .toast-btn`);
      button.click();

      expect(onClick).toHaveBeenCalled();

      vi.advanceTimersByTime(300);

      expect(Toast._toasts.has(id)).toBe(false);

      vi.useRealTimers();
    });

    it('should have close button that dismisses toast', () => {
      vi.useFakeTimers();

      const id = Toast.show({ title: 'Test', duration: 0 });

      const closeBtn = document.querySelector(`#${id} .toast-close`);
      closeBtn.click();

      vi.advanceTimersByTime(300);

      expect(Toast._toasts.has(id)).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('dismiss', () => {
    it('should remove toast from DOM after animation', () => {
      vi.useFakeTimers();

      const id = Toast.show({ title: 'Test', duration: 0 });
      Toast.dismiss(id);

      // Still in DOM during animation
      expect(document.getElementById(id)).not.toBeNull();

      vi.advanceTimersByTime(300);

      expect(document.getElementById(id)).toBeNull();
      expect(Toast._toasts.has(id)).toBe(false);

      vi.useRealTimers();
    });

    it('should do nothing for non-existent toast ID', () => {
      expect(() => Toast.dismiss('nonexistent-id')).not.toThrow();
    });
  });

  describe('dismissAll', () => {
    it('should dismiss all active toasts', () => {
      vi.useFakeTimers();

      Toast.show({ title: 'First', duration: 0 });
      Toast.show({ title: 'Second', duration: 0 });
      Toast.show({ title: 'Third', duration: 0 });

      expect(Toast._toasts.size).toBe(3);

      Toast.dismissAll();

      vi.advanceTimersByTime(300);

      expect(Toast._toasts.size).toBe(0);

      vi.useRealTimers();
    });
  });

  describe('convenience methods', () => {
    it('should create info toast with correct type', () => {
      const id = Toast.info('Title', 'Message');
      const toast = document.getElementById(id);
      expect(toast.classList.contains('toast-info')).toBe(true);
    });

    it('should create success toast with correct type', () => {
      const id = Toast.success('Title', 'Message');
      const toast = document.getElementById(id);
      expect(toast.classList.contains('toast-success')).toBe(true);
    });

    it('should merge additional options', () => {
      const onClick = vi.fn();
      const id = Toast.info('Title', 'Message', {
        actions: [{ label: 'Test', onClick }]
      });

      const toast = document.getElementById(id);
      expect(toast.querySelector('.toast-btn')).not.toBeNull();
    });
  });

  describe('_escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(Toast._escapeHtml('<div>')).toBe('&lt;div&gt;');
      expect(Toast._escapeHtml('a & b')).toBe('a &amp; b');
      expect(Toast._escapeHtml('"quoted"')).toBe('"quoted"');
    });
  });
});
