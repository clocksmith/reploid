/**
 * @fileoverview Unit tests for ConfirmationModal component
 * Tests modal creation, user interactions, and promise resolution
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ConfirmationModalModule from '../../ui/components/confirmation-modal.js';

describe('ConfirmationModal', () => {
  let confirmationModal;
  let mockUtils;

  beforeEach(() => {
    document.body.innerHTML = '';

    mockUtils = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      escapeHtml: (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }
    };

    confirmationModal = ConfirmationModalModule.factory({ Utils: mockUtils });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  describe('metadata', () => {
    it('should have correct module metadata', () => {
      expect(ConfirmationModalModule.metadata.id).toBe('ConfirmationModal');
      expect(ConfirmationModalModule.metadata.type).toBe('ui');
      expect(ConfirmationModalModule.metadata.dependencies).toContain('Utils');
    });
  });

  describe('confirm', () => {
    it('should create modal overlay in DOM', async () => {
      const promise = confirmationModal.confirm({ title: 'Test' });

      expect(document.querySelector('.modal-overlay')).not.toBeNull();

      // Clean up
      document.querySelector('.modal-btn-cancel').click();
      await promise;
    });

    it('should display title', async () => {
      const promise = confirmationModal.confirm({ title: 'My Title' });

      const title = document.querySelector('.modal-title');
      expect(title.textContent).toBe('My Title');

      document.querySelector('.modal-btn-cancel').click();
      await promise;
    });

    it('should display message', async () => {
      const promise = confirmationModal.confirm({ message: 'Are you sure?' });

      const message = document.querySelector('.modal-message');
      expect(message.textContent).toBe('Are you sure?');

      document.querySelector('.modal-btn-cancel').click();
      await promise;
    });

    it('should display custom button text', async () => {
      const promise = confirmationModal.confirm({
        confirmText: 'Yes, Delete',
        cancelText: 'No, Keep'
      });

      const confirmBtn = document.querySelector('.modal-btn-confirm');
      const cancelBtn = document.querySelector('.modal-btn-cancel');

      expect(confirmBtn.textContent).toBe('Yes, Delete');
      expect(cancelBtn.textContent).toBe('No, Keep');

      document.querySelector('.modal-btn-cancel').click();
      await promise;
    });

    it('should display details when provided', async () => {
      const promise = confirmationModal.confirm({
        title: 'Test',
        details: 'Additional information here'
      });

      const details = document.querySelector('.modal-details');
      expect(details).not.toBeNull();
      expect(details.textContent).toBe('Additional information here');

      document.querySelector('.modal-btn-cancel').click();
      await promise;
    });

    it('should not display details when not provided', async () => {
      const promise = confirmationModal.confirm({ title: 'Test' });

      const details = document.querySelector('.modal-details');
      expect(details).toBeNull();

      document.querySelector('.modal-btn-cancel').click();
      await promise;
    });

    it('should add danger class when danger option is true', async () => {
      const promise = confirmationModal.confirm({ danger: true });

      const content = document.querySelector('.modal-content');
      expect(content.classList.contains('modal-danger')).toBe(true);

      const confirmBtn = document.querySelector('.modal-btn-confirm');
      expect(confirmBtn.classList.contains('btn-danger')).toBe(true);

      document.querySelector('.modal-btn-cancel').click();
      await promise;
    });

    it('should use default values when options not provided', async () => {
      const promise = confirmationModal.confirm();

      expect(document.querySelector('.modal-title').textContent).toBe('Confirm Action');
      expect(document.querySelector('.modal-message').textContent).toBe('Are you sure you want to proceed?');
      expect(document.querySelector('.modal-btn-confirm').textContent).toBe('Confirm');
      expect(document.querySelector('.modal-btn-cancel').textContent).toBe('Cancel');

      document.querySelector('.modal-btn-cancel').click();
      await promise;
    });

    it('should escape HTML in title', async () => {
      const promise = confirmationModal.confirm({ title: '<script>alert("xss")</script>' });

      const title = document.querySelector('.modal-title');
      expect(title.innerHTML).not.toContain('<script>');

      document.querySelector('.modal-btn-cancel').click();
      await promise;
    });

    it('should escape HTML in message', async () => {
      const promise = confirmationModal.confirm({ message: '<img onerror="alert(1)">' });

      const message = document.querySelector('.modal-message');
      expect(message.innerHTML).not.toContain('<img');

      document.querySelector('.modal-btn-cancel').click();
      await promise;
    });

    it('should log when modal is shown', async () => {
      const promise = confirmationModal.confirm({ title: 'Test Modal' });

      expect(mockUtils.logger.info).toHaveBeenCalledWith(
        '[ConfirmationModal] Modal shown:',
        'Test Modal'
      );

      document.querySelector('.modal-btn-cancel').click();
      await promise;
    });
  });

  describe('resolve behavior', () => {
    it('should resolve true when confirm button is clicked', async () => {
      const promise = confirmationModal.confirm({ title: 'Confirm' });

      document.querySelector('.modal-btn-confirm').click();

      const result = await promise;
      expect(result).toBe(true);
    });

    it('should resolve false when cancel button is clicked', async () => {
      const promise = confirmationModal.confirm({ title: 'Cancel' });

      document.querySelector('.modal-btn-cancel').click();

      const result = await promise;
      expect(result).toBe(false);
    });

    it('should resolve false when close button is clicked', async () => {
      const promise = confirmationModal.confirm({ title: 'Close' });

      document.querySelector('.modal-close').click();

      const result = await promise;
      expect(result).toBe(false);
    });

    it('should resolve false when Escape key is pressed', async () => {
      const promise = confirmationModal.confirm({ title: 'Escape' });

      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);

      const result = await promise;
      expect(result).toBe(false);
    });

    it('should resolve false when overlay is clicked', async () => {
      const promise = confirmationModal.confirm({ title: 'Overlay' });

      const overlay = document.querySelector('.modal-overlay');
      // Simulate click on overlay (not on modal content)
      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'target', { value: overlay });
      overlay.dispatchEvent(event);

      const result = await promise;
      expect(result).toBe(false);
    });

    it('should not close when clicking inside modal content', async () => {
      const promise = confirmationModal.confirm({ title: 'Content Click' });

      const content = document.querySelector('.modal-content');
      const overlay = document.querySelector('.modal-overlay');

      // Simulate click on content (not overlay)
      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'target', { value: content });
      overlay.dispatchEvent(event);

      // Modal should still be visible
      expect(document.querySelector('.modal-overlay')).not.toBeNull();

      // Clean up
      document.querySelector('.modal-btn-cancel').click();
      await promise;
    });
  });

  describe('closeModal', () => {
    it('should remove modal from DOM', async () => {
      const promise = confirmationModal.confirm({ title: 'Test' });

      expect(document.querySelector('.modal-overlay')).not.toBeNull();

      confirmationModal.closeModal();

      expect(document.querySelector('.modal-overlay')).toBeNull();

      // The promise will still be pending since we closed manually
      // Need to resolve it somehow - in real usage this wouldn't happen
    });

    it('should remove event listeners', async () => {
      const promise = confirmationModal.confirm({ title: 'Test' });

      document.querySelector('.modal-btn-cancel').click();
      await promise;

      // After closing, Escape shouldn't do anything
      const escapeHandler = vi.fn();
      const originalDispatch = document.dispatchEvent.bind(document);

      // Modal is closed, new keypresses should not affect anything
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);

      // No error should occur
    });

    it('should log when modal is closed', async () => {
      const promise = confirmationModal.confirm({ title: 'Test' });

      document.querySelector('.modal-btn-cancel').click();
      await promise;

      expect(mockUtils.logger.info).toHaveBeenCalledWith('[ConfirmationModal] Modal closed');
    });

    it('should do nothing if no modal is active', () => {
      expect(() => confirmationModal.closeModal()).not.toThrow();
    });
  });

  describe('multiple modals', () => {
    it('should close existing modal when opening new one', async () => {
      const promise1 = confirmationModal.confirm({ title: 'First' });

      expect(document.querySelector('.modal-title').textContent).toBe('First');

      const promise2 = confirmationModal.confirm({ title: 'Second' });

      // Should only be one modal
      expect(document.querySelectorAll('.modal-overlay').length).toBe(1);
      expect(document.querySelector('.modal-title').textContent).toBe('Second');

      document.querySelector('.modal-btn-cancel').click();
      await promise2;
    });
  });

  describe('accessibility', () => {
    it('should have close button with aria-label', async () => {
      const promise = confirmationModal.confirm({ title: 'Test' });

      const closeBtn = document.querySelector('.modal-close');
      expect(closeBtn.getAttribute('aria-label')).toBe('Close');

      document.querySelector('.modal-btn-cancel').click();
      await promise;
    });
  });
});
