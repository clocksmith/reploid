/**
 * progress-ui.js - Progress Indicator Component
 * Agent-D | Phase 2 | demo/
 *
 * Handles download and loading progress display.
 */

export class ProgressUI {
  /**
   * @param {HTMLElement} container - Container element for progress overlay
   */
  constructor(container) {
    this.container = container;
    this.overlay = container.querySelector('#progress-overlay');
    this.label = container.querySelector('#progress-label');
    this.bar = container.querySelector('#progress-bar');
    this.detail = container.querySelector('#progress-detail');

    this.isVisible = false;
  }

  /**
   * Show progress overlay with label
   * @param {string} label - Progress label text
   */
  show(label) {
    this.label.textContent = label;
    this.bar.style.width = '0%';
    this.detail.textContent = '';
    this.overlay.hidden = false;
    this.isVisible = true;
  }

  /**
   * Update progress bar and detail text
   * @param {number} percent - Progress percentage (0-100)
   * @param {string} [detail] - Optional detail text
   */
  setProgress(percent, detail) {
    this.bar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    if (detail !== undefined) {
      this.detail.textContent = detail;
    }
  }

  /**
   * Hide progress overlay
   */
  hide() {
    this.overlay.hidden = true;
    this.isVisible = false;
  }

  /**
   * Show indeterminate progress (animated)
   * @param {string} label - Progress label text
   */
  showIndeterminate(label) {
    this.show(label);
    this.bar.style.width = '100%';
    this.bar.style.animation = 'indeterminate 1.5s ease-in-out infinite';
  }

  /**
   * Reset to determinate mode
   */
  setDeterminate() {
    this.bar.style.animation = 'none';
  }

  /**
   * Check if progress is currently visible
   * @returns {boolean}
   */
  isShowing() {
    return this.isVisible;
  }
}

export default ProgressUI;
