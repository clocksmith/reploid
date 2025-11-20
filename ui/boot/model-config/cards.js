// Card Rendering and UI Updates
import {
    MAX_MODELS,
    HOST_TYPE_LABELS,
    getSelectedModels,
    getAvailableProviders,
    setSelectedModels,
    saveToStorage,
    removeModel as removeModelFromState,
    clearModels
} from './state.js';
import { openInlineForm } from './form.js';

// Render model cards
export function renderModelCards() {
    const container = document.getElementById('model-cards-list');
    const addCard = document.getElementById('add-model-card');
    const consensusSection = document.getElementById('consensus-section');
    const selectedModels = getSelectedModels();

    container.innerHTML = '';

    selectedModels.forEach((model, index) => {
        const card = createModelCard(model, index);
        container.appendChild(card);
    });

    container.appendChild(addCard);

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
        <div class="model-card-provider">${model.provider}</div>
        <div class="model-card-name">${model.name}</div>
        <div class="model-card-connection">${HOST_TYPE_LABELS[model.hostType] || model.hostType}</div>
        <div class="model-card-actions">
            <button class="model-card-btn edit" data-index="${index}">Edit</button>
            <button class="model-card-btn remove" data-index="${index}">Remove</button>
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
        if (providers.proxy.online) {
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
        if (providers.webgpu.online) {
            browserLocalIcon.className = 'provider-status-icon online';
            browserLocalText.className = 'provider-status-value online';
            browserLocalText.textContent = 'WebGPU Available';
        } else {
            browserLocalIcon.className = 'provider-status-icon offline';
            browserLocalText.className = 'provider-status-value offline';
            browserLocalText.textContent = 'WebGPU Unavailable';
        }
    }

    // Proxy → Local (Ollama)
    const proxyLocalIcon = document.getElementById('proxy-local-icon');
    const proxyLocalText = document.getElementById('proxy-local-text');
    if (proxyLocalIcon && proxyLocalText) {
        if (providers.ollama.online) {
            proxyLocalIcon.className = 'provider-status-icon online';
            proxyLocalText.className = 'provider-status-value online';
            proxyLocalText.textContent = `Ollama (${providers.ollama.models.length} models)`;
        } else {
            proxyLocalIcon.className = 'provider-status-icon offline';
            proxyLocalText.className = 'provider-status-value offline';
            proxyLocalText.textContent = 'Ollama Offline';
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
            goalInput.placeholder = 'Describe your goal...';
            if (awakenBtn) awakenBtn.disabled = false;
        }
    }
}

// Auto-populate default models
export function autoPopulateDefaultModels() {
    const selectedModels = getSelectedModels();
    const providers = getAvailableProviders();

    if (selectedModels.length > 0) {
        console.log('[ModelConfig] Models already configured, skipping auto-population');
        return;
    }

    console.log('[ModelConfig] No models configured, checking for defaults...');

    // Priority 1: Ollama
    if (providers.ollama.online && providers.ollama.models.length > 0) {
        const powerfulModel = providers.ollama.models.find(m =>
            m.id.includes('qwen3-coder') || m.id.includes('coder')
        ) || providers.ollama.models.find(m =>
            m.id.includes('70b') || m.id.includes('32b') || m.id.includes('30b')
        ) || providers.ollama.models[0];

        const defaultModel = {
            id: powerfulModel.id,
            name: powerfulModel.name,
            provider: 'ollama',
            hostType: 'proxy-local',
            queryMethod: 'proxy',
            keySource: 'none'
        };
        setSelectedModels([defaultModel]);
        saveToStorage();
        console.log('[ModelConfig] Auto-added Ollama default model:', defaultModel);
        return;
    }

    // Priority 2: Cloud proxy
    if (providers.proxy.online) {
        const defaultModel = {
            id: 'gemini-2.5-flash',
            name: 'Flash',
            provider: 'gemini',
            hostType: 'proxy-cloud',
            queryMethod: 'proxy',
            keySource: 'proxy-env'
        };
        setSelectedModels([defaultModel]);
        saveToStorage();
        console.log('[ModelConfig] Auto-added cloud proxy default model:', defaultModel);
        return;
    }

    console.log('[ModelConfig] No default models available');
}

// Setup card-related event listeners
export function setupCardListeners() {
    const providers = getAvailableProviders();

    // Quick WebLLM Demo button
    const quickDemoBtn = document.getElementById('quick-webllm-demo-btn');
    if (quickDemoBtn) {
        quickDemoBtn.addEventListener('click', async () => {
            if (!navigator.gpu) {
                alert('WebGPU not supported in this browser. Use Chrome 113+ or Edge 113+.');
                return;
            }

            const demoModel = {
                id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
                name: 'Llama 3.2 1B',
                provider: 'webllm',
                hostType: 'browser-local',
                queryMethod: 'browser',
                keySource: 'none'
            };

            setSelectedModels([demoModel]);
            renderModelCards();
            saveToStorage();
            updateGoalInputState();

            console.log('[ModelConfig] Quick demo model added:', demoModel);

            // Set a default goal for the demo
            const goalInput = document.getElementById('goal-input');
            if (goalInput && !goalInput.value.trim()) {
                goalInput.value = 'Analyze and improve your own system prompt';
            }

            const awakenBtn = document.getElementById('awaken-btn');
            if (awakenBtn && !awakenBtn.disabled) {
                awakenBtn.click();
            }
        });
    }

    // Add Model card click
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
