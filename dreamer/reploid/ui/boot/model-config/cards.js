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
        console.log('[ModelConfig] Add card is PROMINENT (no models)');
    } else {
        addCard.classList.remove('prominent');
        console.log('[ModelConfig] Add card is normal (' + visibleModelCards + ' models)');
    }

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

    // Update compact model picker dropdown
    updateModelPickerDropdown();
}

// Populate compact model picker dropdown with available models
export function updateModelPickerDropdown() {
    const select = document.getElementById('model-picker-select');
    if (!select) return;

    const providers = getAvailableProviders();
    const selectedModels = getSelectedModels();

    // Clear existing options
    select.innerHTML = '<option value="">Select a model...</option>';

    // Add recommended default option
    const defaultGroup = document.createElement('optgroup');
    defaultGroup.label = 'Recommended';

    // Add WebLLM default if WebGPU available
    if (providers.webgpu?.online) {
        const opt = document.createElement('option');
        opt.value = 'webllm:Qwen2.5-3B-Instruct-q4f32_1-MLC';
        opt.textContent = 'Qwen 2.5 3B (Local WebGPU)';
        defaultGroup.appendChild(opt);
    }

    // Add Gemini Flash if proxy available
    if (providers.proxy?.online) {
        const opt = document.createElement('option');
        opt.value = 'gemini:gemini-2.5-flash';
        opt.textContent = 'Gemini 2.5 Flash (Cloud)';
        defaultGroup.appendChild(opt);
    }

    if (defaultGroup.children.length > 0) {
        select.appendChild(defaultGroup);
    }

    // Add Ollama models
    if (providers.ollama?.online && providers.ollama.models?.length > 0) {
        const ollamaGroup = document.createElement('optgroup');
        ollamaGroup.label = 'Ollama (Local)';
        providers.ollama.models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = `ollama:${m.id}`;
            opt.textContent = m.name || m.id;
            ollamaGroup.appendChild(opt);
        });
        select.appendChild(ollamaGroup);
    }

    // Add WebLLM models (limit to popular ones)
    if (providers.webgpu?.online && providers.webgpu.models?.length > 0) {
        const webllmGroup = document.createElement('optgroup');
        webllmGroup.label = 'WebLLM (Browser)';
        const popularModels = providers.webgpu.models.filter(m =>
            m.id.includes('Qwen') || m.id.includes('Llama') || m.id.includes('Phi')
        ).slice(0, 10);
        popularModels.forEach(m => {
            const opt = document.createElement('option');
            opt.value = `webllm:${m.id}`;
            opt.textContent = m.name || m.id;
            webllmGroup.appendChild(opt);
        });
        if (webllmGroup.children.length > 0) {
            select.appendChild(webllmGroup);
        }
    }

    // Add Dreamer models (local downloaded models)
    if (providers.dreamer?.online && providers.dreamer.models?.length > 0) {
        const dreamerGroup = document.createElement('optgroup');
        const caps = providers.dreamer.capabilities;
        dreamerGroup.label = `Dreamer${caps?.TIER_NAME ? ` (${caps.TIER_NAME})` : ''}`;
        providers.dreamer.models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = `dreamer:${m.id || m}`;
            opt.textContent = m.name || m.id || m;
            dreamerGroup.appendChild(opt);
        });
        select.appendChild(dreamerGroup);
    }

    // Render selected models as chips
    renderSelectedModelChips();
}

// Render selected models as removable chips
function renderSelectedModelChips() {
    const container = document.getElementById('selected-models-chips');
    if (!container) return;

    const selectedModels = getSelectedModels();
    container.innerHTML = '';

    selectedModels.forEach((model, index) => {
        const chip = document.createElement('div');
        chip.className = 'selected-model-chip';
        chip.innerHTML = `
            <span class="chip-provider">${model.provider}</span>
            <span class="chip-name">${model.name || model.id}</span>
            <button class="chip-remove" data-index="${index}" title="Remove">×</button>
        `;
        chip.querySelector('.chip-remove').addEventListener('click', () => {
            removeModelFromState(index);
            renderModelCards();
            renderSelectedModelChips();
            saveToStorage();
            updateGoalInputState();
        });
        container.appendChild(chip);
    });

    // Update consensus section visibility
    const consensusSection = document.getElementById('consensus-section');
    if (consensusSection) {
        if (selectedModels.length >= 2) {
            consensusSection.classList.remove('hidden');
        } else {
            consensusSection.classList.add('hidden');
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

    // Compact model picker dropdown
    const modelPickerSelect = document.getElementById('model-picker-select');
    if (modelPickerSelect) {
        modelPickerSelect.addEventListener('change', (e) => {
            const value = e.target.value;
            if (!value) return;

            const [provider, modelId] = value.split(':');
            if (!provider || !modelId) return;

            // Create model config based on provider
            let model;
            if (provider === 'webllm') {
                model = {
                    id: modelId,
                    name: modelId.split('-').slice(0, 3).join(' '),
                    provider: 'webllm',
                    hostType: 'browser-local',
                    queryMethod: 'browser',
                    keySource: 'none'
                };
            } else if (provider === 'ollama') {
                model = {
                    id: modelId,
                    name: modelId,
                    provider: 'ollama',
                    hostType: 'proxy-local',
                    queryMethod: 'proxy',
                    keySource: 'none'
                };
            } else if (provider === 'gemini') {
                model = {
                    id: modelId,
                    name: 'Gemini Flash',
                    provider: 'gemini',
                    hostType: 'proxy-cloud',
                    queryMethod: 'proxy',
                    keySource: 'proxy-env'
                };
            } else if (provider === 'dreamer') {
                model = {
                    id: modelId,
                    name: modelId,
                    provider: 'dreamer',
                    hostType: 'browser-local',
                    queryMethod: 'browser',
                    keySource: 'none'
                };
            } else {
                return;
            }

            // Add to selected models (replace if single model UI)
            const selectedModels = getSelectedModels();
            if (selectedModels.length === 0) {
                setSelectedModels([model]);
            } else {
                // Add as additional model
                setSelectedModels([...selectedModels, model]);
            }

            renderModelCards();
            saveToStorage();
            updateGoalInputState();
            updateModelPickerDropdown();

            // Reset dropdown
            e.target.value = '';

            console.log('[ModelConfig] Model added via picker:', model);
        });
    }

    // Add Model card click (legacy, still used by modal)
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
