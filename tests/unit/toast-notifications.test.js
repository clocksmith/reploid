/**
 * @fileoverview Unit tests for ToastNotifications component (module-based)
 * Tests toast creation, types, animations, and clearAll
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ToastNotificationsModule from '../../ui/components/toast-notifications.js';

describe('ToastNotifications', () => {
  let toastNotifications;
  let mockUtils;

  beforeEach(() => {
    document.body.innerHTML = '';

    mockUtils = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    };

    toastNotifications = ToastNotificationsModule.factory({ Utils: mockUtils });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllTimers();
  });

  describe('metadata', () => {
    it('should have correct module metadata', () => {
      expect(ToastNotificationsModule.metadata.id).toBe('ToastNotifications');
      expect(ToastNotificationsModule.metadata.type).toBe('ui');
      expect(ToastNotificationsModule.metadata.dependencies).toContain('Utils');
    });
  });

  describe('init', () => {
    it('should create toast container in DOM', () => {
      toastNotifications.init();

      const container = document.getElementById('toast-container');
      expect(container).not.toBeNull();
    });

    it('should position container fixed at top-right', () => {
      toastNotifications.init();

      const container = document.getElementById('toast-container');
      expect(container.style.position).toBe('fixed');
      expect(container.style.top).toBe('20px');
      expect(container.style.right).toBe('20px');
    });

    it('should not create duplicate containers', () => {
      toastNotifications.init();
      toastNotifications.init();
      toastNotifications.init();

      const containers = document.querySelectorAll('#toast-container');
      expect(containers.length).toBe(1);
    });

    it('should log initialization', () => {
      toastNotifications.init();
      expect(mockUtils.logger.info).toHaveBeenCalledWith('[ToastNotifications] Initialized');
    });
  });

  describe('show', () => {
    it('should create toast element', () => {
      toastNotifications.show('Test message');

      const toast = document.querySelector('.toast');
      expect(toast).not.toBeNull();
    });

    it('should display message in toast', () => {
      toastNotifications.show('Hello World');

      const toast = document.querySelector('.toast');
      expect(toast.textContent).toContain('Hello World');
    });

    it('should add type-specific class', () => {
      toastNotifications.show('Success!', 'success');
      expect(document.querySelector('.toast-success')).not.toBeNull();

      toastNotifications.show('Error!', 'error');
      expect(document.querySelector('.toast-error')).not.toBeNull();

      toastNotifications.show('Warning!', 'warning');
      expect(document.querySelector('.toast-warning')).not.toBeNull();

      toastNotifications.show('Info!', 'info');
      expect(document.querySelector('.toast-info')).not.toBeNull();
    });

    it('should default to info type for unknown types', () => {
      toastNotifications.show('Unknown type', 'nonexistent');

      // Should still work without error
      const toast = document.querySelector('.toast');
      expect(toast).not.toBeNull();
    });

    it('should return toast element', () => {
      const toast = toastNotifications.show('Test');
      expect(toast).toBeInstanceOf(HTMLElement);
    });

    it('should initialize container if not already done', () => {
      expect(document.getElementById('toast-container')).toBeNull();

      toastNotifications.show('Test');

      expect(document.getElementById('toast-container')).not.toBeNull();
    });

    it('should auto-dismiss after duration', () => {
      vi.useFakeTimers();

      toastNotifications.show('Auto dismiss', 'info', 1000);

      expect(document.querySelector('.toast')).not.toBeNull();

      vi.advanceTimersByTime(1500);

      expect(document.querySelector('.toast')).toBeNull();

      vi.useRealTimers();
    });

    it('should not auto-dismiss when duration is 0', () => {
      vi.useFakeTimers();

      toastNotifications.show('Persistent', 'info', 0);

      vi.advanceTimersByTime(10000);

      expect(document.querySelector('.toast')).not.toBeNull();

      vi.useRealTimers();
    });

    it('should dismiss on click', () => {
      vi.useFakeTimers();

      toastNotifications.show('Click to dismiss', 'info', 0);

      const toast = document.querySelector('.toast');
      toast.click();

      vi.advanceTimersByTime(500);

      expect(document.querySelector('.toast')).toBeNull();

      vi.useRealTimers();
    });
  });

  describe('convenience methods', () => {
    it('should show success toast', () => {
      toastNotifications.success('Success message');

      const toast = document.querySelector('.toast-success');
      expect(toast).not.toBeNull();
      expect(toast.textContent).toContain('Success message');
    });

    it('should show error toast', () => {
      toastNotifications.error('Error message');

      const toast = document.querySelector('.toast-error');
      expect(toast).not.toBeNull();
      expect(toast.textContent).toContain('Error message');
    });

    it('should show warning toast', () => {
      toastNotifications.warning('Warning message');

      const toast = document.querySelector('.toast-warning');
      expect(toast).not.toBeNull();
      expect(toast.textContent).toContain('Warning message');
    });

    it('should show info toast', () => {
      toastNotifications.info('Info message');

      const toast = document.querySelector('.toast-info');
      expect(toast).not.toBeNull();
      expect(toast.textContent).toContain('Info message');
    });

    it('should pass duration to convenience methods', () => {
      vi.useFakeTimers();

      toastNotifications.success('Quick', 500);

      vi.advanceTimersByTime(1000);

      expect(document.querySelector('.toast')).toBeNull();

      vi.useRealTimers();
    });
  });

  describe('clearAll', () => {
    it('should remove all active toasts', () => {
      toastNotifications.show('Toast 1', 'info', 0);
      toastNotifications.show('Toast 2', 'success', 0);
      toastNotifications.show('Toast 3', 'error', 0);

      expect(document.querySelectorAll('.toast').length).toBe(3);

      toastNotifications.clearAll();

      expect(document.querySelectorAll('.toast').length).toBe(0);
    });

    it('should handle empty toast list', () => {
      expect(() => toastNotifications.clearAll()).not.toThrow();
    });
  });

  describe('toast styling', () => {
    it('should have success toast styling', () => {
      const toast = toastNotifications.success('Test');

      expect(toast.style.background).toContain('rgba(76, 175, 80');
    });

    it('should have error toast styling', () => {
      const toast = toastNotifications.error('Test');

      expect(toast.style.background).toContain('rgba(244, 135, 113');
    });

    it('should have warning toast styling', () => {
      const toast = toastNotifications.warning('Test');

      expect(toast.style.background).toContain('rgba(255, 215, 0');
    });

    it('should have info toast styling', () => {
      const toast = toastNotifications.info('Test');

      expect(toast.style.background).toContain('rgba(79, 195, 247');
    });
  });

  describe('toast icons', () => {
    it('should display success icon', () => {
      const toast = toastNotifications.success('Test');
      expect(toast.textContent).toContain('★');
    });

    it('should display error icon', () => {
      const toast = toastNotifications.error('Test');
      expect(toast.textContent).toContain('☒');
    });

    it('should display warning icon', () => {
      const toast = toastNotifications.warning('Test');
      expect(toast.textContent).toContain('☡');
    });

    it('should display info icon', () => {
      const toast = toastNotifications.info('Test');
      expect(toast.textContent).toContain('☛');
    });

    it('should display close icon', () => {
      const toast = toastNotifications.show('Test');
      expect(toast.textContent).toContain('☩');
    });
  });

  describe('animation', () => {
    it('should start with opacity 0 and translate', () => {
      const toast = toastNotifications.show('Test', 'info', 0);

      expect(toast.style.opacity).toBe('0');
      expect(toast.style.transform).toBe('translateX(400px)');
    });

    it('should animate in after short delay', () => {
      vi.useFakeTimers();

      const toast = toastNotifications.show('Test', 'info', 0);

      vi.advanceTimersByTime(20);

      expect(toast.style.opacity).toBe('1');
      expect(toast.style.transform).toBe('translateX(0)');

      vi.useRealTimers();
    });
  });
});
