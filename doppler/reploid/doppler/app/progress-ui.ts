/**
 * progress-ui.ts - Progress Indicator Component
 * Agent-D | Phase 2 | app/
 *
 * Handles download and loading progress display.
 *
 * @module app/progress-ui
 */

// ============================================================================
// ProgressUI Class
// ============================================================================

export class ProgressUI {
  private container: HTMLElement;
  private overlay: HTMLElement;
  private label: HTMLElement;
  private bar: HTMLElement;
  private detail: HTMLElement;
  private isVisible = false;

  /**
   * @param container - Container element for progress overlay
   */
  constructor(container: HTMLElement) {
    this.container = container;
    this.overlay = container.querySelector('#progress-overlay') as HTMLElement;
    this.label = container.querySelector('#progress-label') as HTMLElement;
    this.bar = container.querySelector('#progress-bar') as HTMLElement;
    this.detail = container.querySelector('#progress-detail') as HTMLElement;
  }

  /**
   * Show progress overlay with label
   * @param label - Progress label text
   */
  show(label: string): void {
    this.label.textContent = label;
    this.bar.style.width = '0%';
    this.detail.textContent = '';
    this.overlay.hidden = false;
    this.isVisible = true;
  }

  /**
   * Update progress bar and detail text
   * @param percent - Progress percentage (0-100)
   * @param detail - Optional detail text
   */
  setProgress(percent: number, detail?: string): void {
    this.bar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    if (detail !== undefined) {
      this.detail.textContent = detail;
    }
  }

  /**
   * Hide progress overlay
   */
  hide(): void {
    this.overlay.hidden = true;
    this.isVisible = false;
  }

  /**
   * Show indeterminate progress (animated)
   * @param label - Progress label text
   */
  showIndeterminate(label: string): void {
    this.show(label);
    this.bar.style.width = '100%';
    this.bar.style.animation = 'indeterminate 1.5s ease-in-out infinite';
  }

  /**
   * Reset to determinate mode
   */
  setDeterminate(): void {
    this.bar.style.animation = 'none';
  }

  /**
   * Check if progress is currently visible
   */
  isShowing(): boolean {
    return this.isVisible;
  }
}

export default ProgressUI;
