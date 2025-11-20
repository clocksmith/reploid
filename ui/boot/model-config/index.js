// Model Configuration - Public API
// Main entry point for the model configuration module

import { getSelectedModels, hasModelsConfigured, loadSavedModels } from './state.js';
import { checkAvailability } from './providers.js';
import { setupFormListeners } from './form.js';
import { renderModelCards, updateStatusDots, updateGoalInputState, autoPopulateDefaultModels, setupCardListeners } from './cards.js';

// Initialize model configuration
export async function initModelConfig() {
    console.log('[ModelConfig] Initializing card-based model selector...');

    // Check what's available
    await checkAvailability();

    // Load saved models
    loadSavedModels();

    // Auto-populate default models if none configured
    autoPopulateDefaultModels();

    // Setup event listeners
    setupFormListeners();
    setupCardListeners();

    // Render initial state
    renderModelCards();
    updateStatusDots();
    updateGoalInputState();
}

// Re-export public functions
export { getSelectedModels, hasModelsConfigured };
