// Model Configuration State Management
// Handles selected models, storage, and constants

export const MAX_MODELS = 4;

export const CONNECTION_TYPE_LABELS = {
    'proxy-local': 'Proxy → Local (Ollama)',
    'browser-local': 'Browser (WebLLM/Transformers)',
    'proxy-cloud': 'Via Proxy Server (Recommended)',
    'browser-cloud': 'Direct API (Requires Key)'
};

export const HOST_TYPE_LABELS = {
    'browser-cloud': 'Direct API',
    'proxy-cloud': 'Via Proxy',
    'browser-local': 'Browser Local',
    'proxy-local': 'Proxy Local',
    // Legacy mappings
    'cloud-browser': 'Direct API',
    'ollama-proxy': 'Proxy Local',
    'webgpu-browser': 'Browser Local',
    'proxy': 'Via Proxy'
};

// State
let selectedModels = [];
let availableProviders = {
    ollama: { online: false, models: [] },
    webgpu: { online: false, models: [] },
    transformers: { online: false, models: [] },
    doppler: { online: false, models: [], capabilities: null },
    proxy: { online: false, configuredProviders: [] }
};

// Getters
export function getSelectedModels() {
    return selectedModels;
}

export function setSelectedModels(models) {
    selectedModels = models;
}

export function getAvailableProviders() {
    return availableProviders;
}

export function setAvailableProviders(providers) {
    availableProviders = providers;
}

export function hasModelsConfigured() {
    return selectedModels.length > 0;
}

export function getConsensusStrategy() {
    return localStorage.getItem('CONSENSUS_TYPE') || 'arena';
}

// Storage operations
export function saveToStorage() {
    try {
        localStorage.setItem('SELECTED_MODELS', JSON.stringify(selectedModels));

        const consensus = document.getElementById('consensus-strategy')?.value || 'arena';
        localStorage.setItem('CONSENSUS_TYPE', consensus);

        // Legacy compatibility
        if (selectedModels.length > 0) {
            const primaryModel = selectedModels[0];
            localStorage.setItem('SELECTED_MODEL', primaryModel.id);
            localStorage.setItem('AI_PROVIDER', primaryModel.provider);
        }

        console.log('[ModelConfig] Configuration saved');
    } catch (error) {
        console.error('[ModelConfig] Failed to save:', error);
    }
}

export function loadSavedModels() {
    try {
        const saved = localStorage.getItem('SELECTED_MODELS');
        if (saved) {
            selectedModels = JSON.parse(saved);
            console.log('[ModelConfig] Loaded saved models:', selectedModels);

            // Warn about potentially invalid models
            const invalidModels = selectedModels.filter(model =>
                model.provider === 'webllm' &&
                model.id &&
                model.id.includes('Qwen2.5-Coder-7B')
            );

            if (invalidModels.length > 0) {
                console.warn('[ModelConfig] Found potentially invalid WebLLM models:',
                    invalidModels.map(m => m.id));
            }
        }
    } catch (error) {
        console.error('[ModelConfig] Failed to load saved models:', error);
    }
}

// Model operations
export function addModel(model) {
    if (selectedModels.length >= MAX_MODELS) {
        return false;
    }
    selectedModels.push(model);
    return true;
}

export function updateModel(index, model) {
    if (index >= 0 && index < selectedModels.length) {
        selectedModels[index] = model;
        return true;
    }
    return false;
}

export function removeModel(index) {
    if (index >= 0 && index < selectedModels.length) {
        selectedModels.splice(index, 1);
        return true;
    }
    return false;
}

export function clearModels() {
    selectedModels = [];
}
