// Model Configuration - Public API
// Main entry point for the model configuration module

import { getSelectedModels, hasModelsConfigured, loadSavedModels } from './state.js';
import { checkAvailability, setStatusChangeCallback } from './providers.js';
import { setupFormListeners } from './form.js';
import { renderModelCards, updateStatusDots, updateGoalInputState, autoPopulateDefaultModels, setupCardListeners } from './cards.js';

// Initialize model configuration
export async function initModelConfig() {
    // Setup callback for progressive status updates
    setStatusChangeCallback(() => {
        updateStatusDots();
        autoPopulateDefaultModels();
        renderModelCards();
        updateGoalInputState();
    });

    // Load saved models first
    loadSavedModels();

    // Setup event listeners
    setupFormListeners();
    setupCardListeners();

    // Render initial state (shows "Checking..." for network providers)
    renderModelCards();
    updateStatusDots();
    updateGoalInputState();

    // Check what's available (updates UI progressively via callback)
    try {
        await checkAvailability();
    } catch (error) {
        console.error('[ModelConfig] Failed to check provider availability:', error.message);
    }

    // Final auto-populate after all checks complete
    autoPopulateDefaultModels();
    renderModelCards();
    updateGoalInputState();
}

// Re-export public functions
export { getSelectedModels, hasModelsConfigured };
