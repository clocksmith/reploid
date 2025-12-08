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
import { cloudProviders } from './providers.js';

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

// Render unified model list (replaces dropdown)
export function renderUnifiedModelList() {
    const container = document.getElementById('model-list');
    if (!container) return;

    const providers = getAvailableProviders();
    const selectedModels = getSelectedModels();
    const selectedIds = new Set(selectedModels.map(m => `${m.provider}:${m.id}:${m.hostType || ''}`));

    container.innerHTML = '';

    // Check if still loading
    const isLoading = !providers.proxy?.checked;

    // Build flat list of all available models
    const allModels = [];

    // 1. Dreamer models (imported GGUF - runs in browser)
    if (providers.dreamer?.online && providers.dreamer.models?.length > 0) {
        const caps = providers.dreamer.capabilities;
        providers.dreamer.models.forEach(m => {
            allModels.push({
                id: m.id || m,
                name: m.name || m.id || m,
                provider: 'dreamer',
                connection: `☖ Browser · ${caps?.TIER_NAME || 'WebGPU'}`,
                hostType: 'browser-local',
                queryMethod: 'browser',
                keySource: 'none',
                priority: 1
            });
        });
    }

    // 2. WebLLM models (downloads to browser)
    if (providers.webgpu?.online && providers.webgpu.models?.length > 0) {
        const curatedModels = [
            { name: 'Qwen2.5-3B-Instruct', size: '3B' },
            { name: 'Llama-3.2-3B-Instruct', size: '3B' },
            { name: 'SmolLM2-360M-Instruct', size: '360M' },
        ];
        for (const { name, size } of curatedModels) {
            const model = providers.webgpu.models.find(m =>
                m.id.includes(name) && (m.id.includes('q4f16') || m.id.includes('q4f32'))
            );
            if (model) {
                allModels.push({
                    id: model.id,
                    name: name.replace(/-/g, ' '),
                    provider: 'webllm',
                    connection: `☖ Browser · WebGPU · ${size}`,
                    hostType: 'browser-local',
                    queryMethod: 'browser',
                    keySource: 'none',
                    priority: 2
                });
            }
        }
    }

    // 3. Ollama models (via proxy)
    if (providers.ollama?.online && providers.ollama.models?.length > 0) {
        providers.ollama.models.slice(0, 5).forEach(m => {
            allModels.push({
                id: m.id,
                name: m.name || m.id,
                provider: 'ollama',
                connection: '☍ Proxy → Ollama',
                hostType: 'proxy-local',
                queryMethod: 'proxy',
                keySource: 'none',
                priority: 3
            });
        });
    }

    // 4. Cloud models via proxy (uses server's API key)
    if (providers.proxy?.online) {
        // Add proxy versions for all cloud providers
        for (const [providerId, provider] of Object.entries(cloudProviders)) {
            provider.models.slice(0, 2).forEach(m => {
                allModels.push({
                    id: m.id,
                    name: m.name,
                    provider: providerId,
                    connection: `☍ Proxy → ${provider.name} (server key)`,
                    hostType: 'proxy-cloud',
                    queryMethod: 'proxy',
                    keySource: 'proxy-env',
                    priority: 4
                });
            });
        }
    }

    // 5. Direct cloud (browser → cloud, needs your API key)
    for (const [providerId, provider] of Object.entries(cloudProviders)) {
        provider.models.slice(0, 2).forEach(m => {
            allModels.push({
                id: m.id,
                name: m.name,
                provider: providerId,
                connection: `☁ Browser → ${provider.name} (your key)`,
                hostType: 'browser-cloud',
                queryMethod: 'browser',
                keySource: 'localStorage',
                requiresKey: true,
                priority: 5
            });
        });
    }

    // Sort by priority
    allModels.sort((a, b) => a.priority - b.priority);

    // Render loading state
    if (isLoading && allModels.length === 0) {
        container.innerHTML = '<div class="model-list-loading">Checking connections...</div>';
        return;
    }

    // Render models
    if (allModels.length === 0) {
        container.innerHTML = `
            <div class="model-list-empty">
                <div class="empty-icon">☒</div>
                <div>No models available</div>
            </div>
        `;
        return;
    }

    for (const model of allModels) {
        const key = `${model.provider}:${model.id}:${model.hostType || ''}`;
        const isSelected = selectedIds.has(key);

        const item = document.createElement('div');
        item.className = `model-list-item${isSelected ? ' selected' : ''}`;

        item.innerHTML = `
            <span class="model-icon">${isSelected ? '★' : '○'}</span>
            <div class="model-info">
                <div class="model-name">${model.name}</div>
                <div class="model-meta">${model.connection}${model.requiresKey ? ' • needs key' : ''}</div>
            </div>
            <span class="model-status">${isSelected ? '✓' : '+'}</span>
        `;

        item.addEventListener('click', () => toggleModelSelection(model, isSelected));
        container.appendChild(item);
    }

    updateConsensusVisibility();
}

// Toggle model selection
function toggleModelSelection(model, isCurrentlySelected) {
    const selectedModels = getSelectedModels();

    if (isCurrentlySelected) {
        // Remove model
        const newModels = selectedModels.filter(m =>
            !(m.provider === model.provider && m.id === model.id)
        );
        setSelectedModels(newModels);
    } else {
        // Check if requires API key
        if (model.requiresKey) {
            const keyName = `${model.provider.toUpperCase()}_API_KEY`;
            const existingKey = localStorage.getItem(keyName);
            if (!existingKey) {
                // Open form to get API key
                openInlineForm(null, model.provider);
                return;
            }
        }

        // Add model
        if (selectedModels.length >= MAX_MODELS) {
            alert(`Maximum ${MAX_MODELS} models allowed`);
            return;
        }
        const newModel = {
            id: model.id,
            name: model.name,
            provider: model.provider,
            hostType: model.hostType,
            queryMethod: model.queryMethod,
            keySource: model.keySource
        };
        setSelectedModels([...selectedModels, newModel]);
    }

    renderUnifiedModelList();
    renderSelectedChips();
    updatePickerLabel();
    renderModelCards();
    saveToStorage();
    updateGoalInputState();
}

// Update consensus section visibility
function updateConsensusVisibility() {
    const consensusSection = document.getElementById('consensus-section');
    if (consensusSection) {
        const selectedModels = getSelectedModels();
        if (selectedModels.length >= 2) {
            consensusSection.classList.remove('hidden');
        } else {
            consensusSection.classList.add('hidden');
        }
    }
}

// Legacy: keep for compatibility but redirect to unified list
export function updateModelPickerDropdown() {
    renderUnifiedModelList();
    renderSelectedChips();
    updatePickerLabel();
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

// Auto-populate default models (disabled - user must explicitly add models)
export function autoPopulateDefaultModels() {
    // No-op: models are not auto-populated after reset
}

// Setup card-related event listeners
export function setupCardListeners() {
    // Model picker popup toggle
    const trigger = document.getElementById('model-picker-trigger');
    const popup = document.getElementById('model-picker-popup');

    if (trigger && popup) {
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = !popup.classList.contains('hidden');
            if (isOpen) {
                closeModelPicker();
            } else {
                popup.classList.remove('hidden');
                trigger.classList.add('open');
                renderUnifiedModelList(); // Refresh list when opening
            }
        });

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!popup.contains(e.target) && !trigger.contains(e.target)) {
                closeModelPicker();
            }
        });

        // Close on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeModelPicker();
            }
        });
    }

    // Configure custom model button
    const configureBtn = document.getElementById('configure-model-btn');
    if (configureBtn) {
        configureBtn.addEventListener('click', () => {
            closeModelPicker();
            if (getSelectedModels().length >= MAX_MODELS) {
                alert(`Maximum ${MAX_MODELS} models allowed`);
                return;
            }
            openInlineForm();
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

// Close model picker popup
function closeModelPicker() {
    const popup = document.getElementById('model-picker-popup');
    const trigger = document.getElementById('model-picker-trigger');
    if (popup) popup.classList.add('hidden');
    if (trigger) trigger.classList.remove('open');
}

// Update picker trigger label
function updatePickerLabel() {
    const label = document.getElementById('picker-label');
    const selectedModels = getSelectedModels();

    if (label) {
        if (selectedModels.length === 0) {
            label.textContent = 'Choose model...';
        } else if (selectedModels.length === 1) {
            label.textContent = `${selectedModels[0].name || selectedModels[0].id}`;
        } else {
            label.textContent = `${selectedModels.length} models selected`;
        }
    }
}

// Render selected models as chips
function renderSelectedChips() {
    const container = document.getElementById('selected-models-row');
    if (!container) return;

    const selectedModels = getSelectedModels();
    container.innerHTML = '';

    selectedModels.forEach((model, index) => {
        const chip = document.createElement('div');
        chip.className = 'selected-model-chip';

        const icon = model.hostType?.includes('browser') ? '☖' :
                     model.hostType?.includes('proxy') ? '☍' : '☁';

        chip.innerHTML = `
            <span class="chip-icon">${icon}</span>
            <span class="chip-name">${model.name || model.id}</span>
            <button class="chip-remove" title="Remove">×</button>
        `;

        chip.querySelector('.chip-remove').addEventListener('click', () => {
            removeModelFromState(index);
            renderSelectedChips();
            updatePickerLabel();
            renderUnifiedModelList();
            saveToStorage();
            updateGoalInputState();
        });

        container.appendChild(chip);
    });

    updateConsensusVisibility();
}
