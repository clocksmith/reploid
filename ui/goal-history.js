/**
 * @fileoverview Goal History Manager
 * Persists and displays recent goals for quick resume.
 */

const GoalHistory = {
  STORAGE_KEY: 'REPLOID_GOAL_HISTORY',
  MAX_HISTORY: 10,

  _getHistory() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  },

  _saveHistory(history) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
  },

  /**
   * Add a goal to history
   * @param {string} goal - The goal text
   */
  add(goal) {
    if (!goal || typeof goal !== 'string') return;

    const trimmed = goal.trim();
    if (!trimmed) return;

    let history = this._getHistory();

    // Remove if already exists (to move to top)
    history = history.filter(h => h.text !== trimmed);

    // Add to beginning
    history.unshift({
      text: trimmed,
      timestamp: Date.now()
    });

    // Limit size
    if (history.length > this.MAX_HISTORY) {
      history = history.slice(0, this.MAX_HISTORY);
    }

    this._saveHistory(history);
  },

  /**
   * Get all history entries
   * @returns {Array} Array of {text, timestamp} objects
   */
  getAll() {
    return this._getHistory();
  },

  /**
   * Clear all history
   */
  clear() {
    localStorage.removeItem(this.STORAGE_KEY);
  },

  /**
   * Format timestamp as relative time
   * @param {number} timestamp
   * @returns {string}
   */
  formatTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  },

  /**
   * Initialize the goal history dropdown UI
   * @param {HTMLElement} inputElement - The goal input element
   * @param {Function} onSelect - Callback when a goal is selected
   */
  initDropdown(inputElement, onSelect) {
    if (!inputElement) return;

    const container = document.createElement('div');
    container.className = 'goal-history-container';

    // Wrap the input
    inputElement.parentNode.insertBefore(container, inputElement);
    container.appendChild(inputElement);

    // Create dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'goal-history-dropdown hidden';
    container.appendChild(dropdown);

    let isOpen = false;

    const renderDropdown = () => {
      const history = this.getAll();

      if (history.length === 0) {
        dropdown.innerHTML = '<div class="goal-history-empty">No recent goals</div>';
      } else {
        dropdown.innerHTML = history.map((item, index) => `
          <div class="goal-history-item" data-index="${index}">
            <div class="goal-history-text">${this._escapeHtml(item.text)}</div>
            <div class="goal-history-time">${this.formatTime(item.timestamp)}</div>
          </div>
        `).join('');

        // Add click handlers
        dropdown.querySelectorAll('.goal-history-item').forEach((el, index) => {
          el.addEventListener('click', () => {
            const item = history[index];
            if (item && onSelect) {
              onSelect(item.text);
            }
            closeDropdown();
          });
        });
      }
    };

    const openDropdown = () => {
      if (isOpen) return;
      renderDropdown();
      dropdown.classList.remove('hidden');
      isOpen = true;
    };

    const closeDropdown = () => {
      dropdown.classList.add('hidden');
      isOpen = false;
    };

    // Open on focus if input is empty
    inputElement.addEventListener('focus', () => {
      if (!inputElement.value.trim()) {
        openDropdown();
      }
    });

    // Close on blur (with delay to allow click)
    inputElement.addEventListener('blur', () => {
      setTimeout(closeDropdown, 200);
    });

    // Close when typing
    inputElement.addEventListener('input', () => {
      if (inputElement.value.trim()) {
        closeDropdown();
      } else {
        openDropdown();
      }
    });

    // Handle arrow keys
    inputElement.addEventListener('keydown', (e) => {
      if (!isOpen) return;

      const items = dropdown.querySelectorAll('.goal-history-item');
      const currentIndex = Array.from(items).findIndex(i => i.classList.contains('hover'));

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        items.forEach((item, i) => item.classList.toggle('hover', i === nextIndex));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        items.forEach((item, i) => item.classList.toggle('hover', i === prevIndex));
      } else if (e.key === 'Enter' && currentIndex >= 0) {
        e.preventDefault();
        items[currentIndex].click();
      }
    });

    return { openDropdown, closeDropdown, renderDropdown };
  },

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

export default GoalHistory;
