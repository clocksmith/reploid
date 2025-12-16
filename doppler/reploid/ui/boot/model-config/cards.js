// Card Rendering and UI Updates
import {
    MAX_MODELS,
    HOST_TYPE_LABELS,
    getSelectedModels,
    getAvailableProviders,
    saveToStorage,
    addModel,
    removeModel as removeModelFromState
} from './state.js';
import { openInlineForm } from './form.js';

// Render model cards
export function renderModelCards() {
    const container = document.getElementById('model-cards-list');
    const addCard = document.getElementById('add-model-card');
    const consensusSection = document.getElementById('consensus-section');
    const selectedModels = getSelectedModels();

    if (!container || !addCard) {
        console.warn('[ModelConfig] Model cards container or add-card not found in DOM');
        return;
    }

    container.innerHTML = '';

    selectedModels.forEach((model, index) => {
        const card = createModelCard(model, index);
        container.appendChild(card);
    });

    container.appendChild(addCard);

    // Make add button prominent when no model cards are visible (excluding add-model-card)
    const visibleModelCards = container.querySelectorAll('.model-card:not(.add-model-card)').length;
    if (visibleModelCards === 0) {
        addCard.classList.add('prominent');
    } else {
        addCard.classList.remove('prominent');
    }

    // Update consensus section visibility
    if (consensusSection) {
        if (selectedModels.length >= 2) {
            consensusSection.classList.remove('hidden');
        } else {
            consensusSection.classList.add('hidden');
        }
    }
}

// Create model card element
function createModelCard(model, index) {
    const card = document.createElement('div');
    card.className = 'model-card';
    card.innerHTML = `
        <div class="model-card-content">
            <div>
                <div class="model-card-provider">${model.provider}</div>
                <div class="model-card-name">${model.name}</div>
                <div class="model-card-connection">${HOST_TYPE_LABELS[model.hostType] || model.hostType}</div>
            </div>
            <div class="model-card-actions">
                <button class="model-card-btn edit" data-index="${index}">edit</button>
                <button class="model-card-btn remove" data-index="${index}">Remove</button>
            </div>
        </div>
    `;

    card.querySelector('.edit').addEventListener('click', () => {
        openInlineForm(index);
    });

    card.querySelector('.remove').addEventListener('click', () => {
        removeModel(index);
    });

    return card;
}

// Remove model
function removeModel(index) {
    if (confirm('Remove this model?')) {
        removeModelFromState(index);
        renderModelCards();
        saveToStorage();
        updateGoalInputState();
    }
}

// Update status indicators
export function updateStatusDots() {
    const providers = getAvailableProviders();

    // Update header badges (new compact UI)
    if (window.updateHeaderBadges) {
        window.updateHeaderBadges(providers);
    }

    // Browser → Cloud (always ready)
    const browserCloudIcon = document.getElementById('browser-cloud-icon');
    const browserCloudText = document.getElementById('browser-cloud-text');
    if (browserCloudIcon && browserCloudText) {
        browserCloudIcon.className = 'provider-status-icon online';
        browserCloudText.className = 'provider-status-value online';
        browserCloudText.textContent = 'Ready';
    }

    // Proxy → Cloud
    const proxyCloudIcon = document.getElementById('proxy-cloud-icon');
    const proxyCloudText = document.getElementById('proxy-cloud-text');
    if (proxyCloudIcon && proxyCloudText) {
        if (!providers.proxy.checked) {
            proxyCloudIcon.className = 'provider-status-icon checking';
            proxyCloudText.className = 'provider-status-value checking';
            proxyCloudText.textContent = 'Checking...';
        } else if (providers.proxy.online) {
            proxyCloudIcon.className = 'provider-status-icon online';
            proxyCloudText.className = 'provider-status-value online';
            proxyCloudText.textContent = 'Available';
        } else {
            proxyCloudIcon.className = 'provider-status-icon offline';
            proxyCloudText.className = 'provider-status-value offline';
            proxyCloudText.textContent = 'Unavailable';
        }
    }

    // Browser → Local (WebGPU)
    const browserLocalIcon = document.getElementById('browser-local-icon');
    const browserLocalText = document.getElementById('browser-local-text');
    if (browserLocalIcon && browserLocalText) {
        if (!providers.webgpu.checked) {
            browserLocalIcon.className = 'provider-status-icon checking';
            browserLocalText.className = 'provider-status-value checking';
            browserLocalText.textContent = 'Checking...';
        } else if (providers.webgpu.online) {
            browserLocalIcon.className = 'provider-status-icon online';
            browserLocalText.className = 'provider-status-value online';
            browserLocalText.textContent = 'WebGPU Available';
        } else {
            browserLocalIcon.className = 'provider-status-icon offline';
            browserLocalText.className = 'provider-status-value offline';
            browserLocalText.textContent = 'No WebGPU';
        }
    }

    // Proxy → Local (Ollama)
    const proxyLocalIcon = document.getElementById('proxy-local-icon');
    const proxyLocalText = document.getElementById('proxy-local-text');
    if (proxyLocalIcon && proxyLocalText) {
        if (!providers.ollama.checked) {
            proxyLocalIcon.className = 'provider-status-icon checking';
            proxyLocalText.className = 'provider-status-value checking';
            proxyLocalText.textContent = 'Checking...';
        } else if (providers.ollama.online) {
            proxyLocalIcon.className = 'provider-status-icon online';
            proxyLocalText.className = 'provider-status-value online';
            proxyLocalText.textContent = `Ollama (${providers.ollama.models.length} models)`;
        } else {
            proxyLocalIcon.className = 'provider-status-icon offline';
            proxyLocalText.className = 'provider-status-value offline';
            proxyLocalText.textContent = 'Unavailable';
        }
    }
}

// Update goal input state
export function updateGoalInputState() {
    const goalInput = document.getElementById('goal-input');
    const awakenBtn = document.getElementById('awaken-btn');
    const selectedModels = getSelectedModels();

    if (goalInput) {
        if (selectedModels.length === 0) {
            goalInput.disabled = true;
            goalInput.placeholder = '► Select at least one model to continue';
            if (awakenBtn) awakenBtn.disabled = true;
        } else {
            goalInput.disabled = false;
            goalInput.placeholder = 'Describe a goal...';
            if (awakenBtn) awakenBtn.disabled = false;
        }
    }
}

// Auto-populate default model: Doppler Gemma 1B when available
export function autoPopulateDefaultModels() {
    const selectedModels = getSelectedModels();
    const providers = getAvailableProviders();

    // Only auto-populate if no models are selected and Doppler is available
    if (selectedModels.length > 0) return;
    if (!providers.doppler?.online) return;

    // Find Gemma 1B model in Doppler's available models
    const dopplerModels = providers.doppler.models || [];
    const gemmaModel = dopplerModels.find(m =>
        m.id.toLowerCase().includes('gemma') && m.id.includes('1b')
    );

    if (gemmaModel) {
        const defaultModel = {
            id: gemmaModel.id,
            name: gemmaModel.name || gemmaModel.id,
            provider: 'doppler',
            hostType: 'browser-local',
            queryMethod: 'browser',
            keySource: 'none',
            keyId: null,
            modelUrl: null,
            localPath: null,
        };

        addModel(defaultModel);
        renderModelCards();
        saveToStorage();
        updateGoalInputState();
        console.log('[ModelConfig] Auto-populated default model:', defaultModel.name);
    }
}

// Setup card-related event listeners
export function setupCardListeners() {
    // Add Model card click - opens form dialog
    const addModelCard = document.getElementById('add-model-card');
    if (addModelCard) {
        addModelCard.addEventListener('click', () => {
            if (getSelectedModels().length >= MAX_MODELS) {
                alert(`Maximum ${MAX_MODELS} models allowed`);
                return;
            }
            openInlineForm();
        });
    }
}
