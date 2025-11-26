// Add/Edit Model Form Logic
import {
    MAX_MODELS,
    CONNECTION_TYPE_LABELS,
    getSelectedModels,
    getAvailableProviders,
    saveToStorage,
    addModel,
    updateModel
} from './state.js';
import { cloudProviders, getModelsForProvider, getConnectionOptions } from './providers.js';
import { renderModelCards, updateGoalInputState } from './cards.js';

// Open inline form for adding/editing
export function openInlineForm(editingIndex = null) {
    const form = document.getElementById('model-form-inline');
    const formTitle = document.getElementById('model-form-title');
    const saveBtn = document.getElementById('save-model-btn');

    form.classList.remove('hidden');
    formTitle.textContent = editingIndex !== null ? 'Edit Model' : 'Add Model';
    saveBtn.textContent = editingIndex !== null ? 'Save Changes' : 'Add Model';
    saveBtn.dataset.editingIndex = editingIndex !== null ? editingIndex : '';

    populateProviderSelect();
    resetInlineForm();

    if (editingIndex !== null) {
        const model = getSelectedModels()[editingIndex];
        populateEditForm(model);
    }
}

// Close inline form
export function closeInlineForm() {
    const form = document.getElementById('model-form-inline');
    form.classList.add('hidden');
    resetInlineForm();
}

// Populate provider select dropdown
function populateProviderSelect() {
    const providerSelect = document.getElementById('provider-select');
    const providers = getAvailableProviders();
    const options = ['<option value="">Select provider...</option>'];

    if (providers.ollama.online && providers.ollama.models.length > 0) {
        options.push('<option value="ollama">Ollama (Local)</option>');
    }

    if (providers.webgpu.online) {
        options.push('<option value="webllm">WebLLM (Browser)</option>');
    }

    if (providers.transformers?.online) {
        options.push('<option value="transformers">Transformers.js (Browser)</option>');
    }

    // Cloud providers always available - user provides API key
    options.push('<option value="gemini">Google Gemini (Cloud)</option>');
    options.push('<option value="openai">OpenAI (Cloud)</option>');
    options.push('<option value="anthropic">Anthropic Claude (Cloud)</option>');

    providerSelect.innerHTML = options.join('');
}

// Handle provider selection change
export function onProviderChange(e) {
    const provider = e.target.value;
    const modelSelectGroup = document.getElementById('model-select-group');
    const modelSelect = document.getElementById('model-select-dropdown');
    const apiKeyGroup = document.getElementById('api-key-group');
    const connectionTypeGroup = document.getElementById('connection-type-group');
    const saveBtn = document.getElementById('save-model-btn');

    modelSelectGroup.classList.add('hidden');
    apiKeyGroup.classList.add('hidden');
    connectionTypeGroup.classList.add('hidden');
    saveBtn.disabled = true;

    if (!provider) return;

    const models = getModelsForProvider(provider);
    const connectionOptions = getConnectionOptions(provider);
    const autoConnectionType = connectionOptions[0] || '';

    // Show model select
    modelSelectGroup.classList.remove('hidden');
    modelSelect.innerHTML = '<option value="">Select model...</option>' +
        models.map(m => {
            const vramInfo = m.vram ? ` (${(m.vram / 1024).toFixed(1)}GB)` : '';
            return `<option value="${m.id}">${m.name}${vramInfo}</option>`;
        }).join('');

    // Connection type dropdown
    applyConnectionTypeOptions(connectionOptions, autoConnectionType);
    if (connectionOptions.length > 1) {
        connectionTypeGroup.classList.remove('hidden');
    }
    onConnectionTypeChange({ target: { value: autoConnectionType } });
}

function applyConnectionTypeOptions(connectionOptions, selectedType) {
    const connectionTypeSelect = document.getElementById('connection-type-select');
    const options = ['<option value="">Select connection type...</option>'];

    connectionOptions.forEach(type => {
        const label = CONNECTION_TYPE_LABELS[type] || type;
        options.push(`<option value="${type}">${label}</option>`);
    });

    connectionTypeSelect.innerHTML = options.join('');
    connectionTypeSelect.value = selectedType || '';
}

// Handle connection type change
export function onConnectionTypeChange(e) {
    const connectionType = e.target.value;
    const provider = document.getElementById('provider-select').value;
    const apiKeyGroup = document.getElementById('api-key-group');

    if (connectionType === 'browser-cloud') {
        apiKeyGroup.classList.remove('hidden');
        const savedKey = localStorage.getItem(`${provider.toUpperCase()}_API_KEY`);
        if (savedKey) {
            document.getElementById('model-api-key').value = savedKey;
        }
    } else {
        apiKeyGroup.classList.add('hidden');
        document.getElementById('model-api-key').value = '';
    }

    validateForm();
}

// Handle model selection change
export function onModelChange() {
    validateForm();
}

// Validate form and enable/disable save button
export function validateForm() {
    const saveBtn = document.getElementById('save-model-btn');
    const provider = document.getElementById('provider-select').value;
    const modelId = document.getElementById('model-select-dropdown').value;
    const connectionType = document.getElementById('connection-type-select').value;

    if (!provider || !modelId || !connectionType) {
        saveBtn.disabled = true;
        return;
    }

    if (connectionType === 'browser-cloud') {
        const apiKey = document.getElementById('model-api-key').value.trim();
        saveBtn.disabled = !apiKey;
    } else {
        saveBtn.disabled = false;
    }
}

// Save model (add or edit)
export function saveModel() {
    const provider = document.getElementById('provider-select').value;
    const modelId = document.getElementById('model-select-dropdown').value;
    const modelName = document.getElementById('model-select-dropdown').selectedOptions[0]?.text;
    const connectionType = document.getElementById('connection-type-select').value;
    const apiKey = document.getElementById('model-api-key').value.trim();
    const editingIndex = document.getElementById('save-model-btn').dataset.editingIndex;

    if (!provider || !modelId || !connectionType) {
        alert('Please select a provider, model, and connection type');
        return;
    }

    const queryMethod = connectionType.startsWith('proxy-') ? 'proxy' : 'browser';

    // Save API key if provided
    if (apiKey && connectionType === 'browser-cloud') {
        localStorage.setItem(`${provider.toUpperCase()}_API_KEY`, apiKey);
    }

    // Determine key source
    let keySource = 'none';
    let keyId = null;
    if (connectionType === 'browser-cloud') {
        keySource = 'localStorage';
        keyId = `${provider.toUpperCase()}_API_KEY`;
    } else if (connectionType === 'proxy-cloud') {
        keySource = 'proxy-env';
    }

    const modelConfig = {
        id: modelId,
        name: modelName,
        provider: provider,
        hostType: connectionType,
        queryMethod: queryMethod,
        keySource: keySource,
        keyId: keyId
    };

    if (editingIndex !== '') {
        updateModel(parseInt(editingIndex), modelConfig);
    } else {
        if (!addModel(modelConfig)) {
            alert(`Maximum ${MAX_MODELS} models allowed`);
            return;
        }
    }

    renderModelCards();
    saveToStorage();
    updateGoalInputState();
    closeInlineForm();

    console.log('[ModelConfig] Model saved:', modelConfig);
}

// Reset inline form
function resetInlineForm() {
    document.getElementById('provider-select').value = '';
    document.getElementById('model-select-dropdown').innerHTML = '<option value="">Select model...</option>';
    document.getElementById('connection-type-select').innerHTML = '<option value="">Select connection type...</option>';
    document.getElementById('model-api-key').value = '';
    document.getElementById('model-select-group').classList.add('hidden');
    document.getElementById('connection-type-group').classList.add('hidden');
    document.getElementById('api-key-group').classList.add('hidden');
    document.getElementById('save-model-btn').disabled = true;
}

// Populate edit form
function populateEditForm(model) {
    document.getElementById('provider-select').value = model.provider;
    onProviderChange({ target: { value: model.provider } });

    setTimeout(() => {
        document.getElementById('model-select-dropdown').value = model.id;
        const connectionSelect = document.getElementById('connection-type-select');
        const hasOption = Array.from(connectionSelect.options).some(opt => opt.value === model.hostType);
        if (!hasOption && model.hostType) {
            const option = document.createElement('option');
            option.value = model.hostType;
            option.textContent = CONNECTION_TYPE_LABELS[model.hostType] || model.hostType;
            connectionSelect.appendChild(option);
        }
        connectionSelect.value = model.hostType;
        onConnectionTypeChange({ target: { value: model.hostType } });
    }, 100);
}

// Setup event listeners for form elements
export function setupFormListeners() {
    const closeBtn = document.getElementById('close-model-form');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeInlineForm);
    }

    const cancelBtn = document.getElementById('cancel-model-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeInlineForm);
    }

    const saveBtnEl = document.getElementById('save-model-btn');
    if (saveBtnEl) {
        saveBtnEl.addEventListener('click', saveModel);
    }

    const providerSelect = document.getElementById('provider-select');
    if (providerSelect) {
        providerSelect.addEventListener('change', onProviderChange);
    }

    const modelSelect = document.getElementById('model-select-dropdown');
    if (modelSelect) {
        modelSelect.addEventListener('change', onModelChange);
    }

    const connectionTypeSelect = document.getElementById('connection-type-select');
    if (connectionTypeSelect) {
        connectionTypeSelect.addEventListener('change', onConnectionTypeChange);
    }

    // API key input - listen for input, change, and handle autofill
    const apiKeyInput = document.getElementById('model-api-key');
    if (apiKeyInput) {
        apiKeyInput.addEventListener('input', validateForm);
        apiKeyInput.addEventListener('change', validateForm);
        apiKeyInput.addEventListener('paste', () => setTimeout(validateForm, 0));
        // Handle autofill by polling briefly after focus
        apiKeyInput.addEventListener('focus', () => {
            const checkAutofill = setInterval(() => {
                if (apiKeyInput.value) {
                    validateForm();
                    clearInterval(checkAutofill);
                }
            }, 100);
            // Stop polling after 2 seconds
            setTimeout(() => clearInterval(checkAutofill), 2000);
        });
    }

    const consensusSelect = document.getElementById('consensus-strategy');
    if (consensusSelect) {
        consensusSelect.addEventListener('change', () => {
            saveToStorage();
        });
    }
}
