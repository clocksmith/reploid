// Add/edit Model Form Logic
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

// Check if Native Bridge is available (lazy loaded)
let bridgeAvailableCache = null;
async function checkBridgeAvailable() {
    if (bridgeAvailableCache !== null) return bridgeAvailableCache;
    try {
        const { isBridgeAvailable } = await import('../../../dreamer/bridge/index.js');
        bridgeAvailableCache = isBridgeAvailable();
    } catch {
        bridgeAvailableCache = false;
    }
    return bridgeAvailableCache;
}

// Open inline form for adding/editing
export function openInlineForm(editingIndex = null) {
    const overlay = document.getElementById('model-form-overlay');
    const formTitle = document.getElementById('model-form-title');
    const saveBtn = document.getElementById('save-model-btn');

    // Update form content
    formTitle.textContent = editingIndex !== null ? 'edit Model' : 'Add Model';
    saveBtn.textContent = editingIndex !== null ? 'Save Changes' : 'Add Model';
    saveBtn.dataset.editingIndex = editingIndex !== null ? editingIndex : '';

    populateProviderSelect();
    resetInlineForm();

    if (editingIndex !== null) {
        const model = getSelectedModels()[editingIndex];
        populateeditForm(model);
    }

    // Open with animation
    overlay.classList.remove('closing');
    overlay.classList.add('open');

    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden';
}

// Close modal form with animation
export function closeInlineForm() {
    const overlay = document.getElementById('model-form-overlay');

    // Add closing class for exit animation
    overlay.classList.add('closing');

    // Wait for animation to complete before hiding
    setTimeout(() => {
        overlay.classList.remove('open', 'closing');
        resetInlineForm();
        document.body.style.overflow = '';
    }, 200);
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

    if (providers.dreamer?.online) {
        const caps = providers.dreamer.capabilities;
        const tierLabel = caps?.TIER_NAME ? ` (${caps.TIER_NAME})` : '';
        options.push(`<option value="dreamer">Dreamer${tierLabel} (Local WebGPU)</option>`);
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
    const modelUrlGroup = document.getElementById('model-url-group');
    const saveBtn = document.getElementById('save-model-btn');

    modelSelectGroup.classList.add('hidden');
    apiKeyGroup.classList.add('hidden');
    connectionTypeGroup.classList.add('hidden');
    if (modelUrlGroup) modelUrlGroup.classList.add('hidden');
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

    // Show model URL field for Dreamer provider
    if (modelUrlGroup) {
        if (provider === 'dreamer') {
            modelUrlGroup.classList.remove('hidden');
        } else {
            modelUrlGroup.classList.add('hidden');
            const urlInput = document.getElementById('model-url-input');
            if (urlInput) urlInput.value = '';
        }
    }

    // Show local path field for Dreamer when Native Bridge is available
    const localPathGroup = document.getElementById('local-path-group');
    if (localPathGroup) {
        if (provider === 'dreamer') {
            // Check bridge availability asynchronously
            checkBridgeAvailable().then(available => {
                if (available) {
                    localPathGroup.classList.remove('hidden');
                } else {
                    localPathGroup.classList.add('hidden');
                }
            });
        } else {
            localPathGroup.classList.add('hidden');
            const pathInput = document.getElementById('local-path-input');
            if (pathInput) pathInput.value = '';
        }
    }

    // Show GGUF import button for Dreamer provider (browser import via File System Access)
    const ggufImportGroup = document.getElementById('gguf-import-group');
    const ggufProgressGroup = document.getElementById('gguf-import-progress');
    if (ggufImportGroup) {
        if (provider === 'dreamer') {
            ggufImportGroup.classList.remove('hidden');
        } else {
            ggufImportGroup.classList.add('hidden');
            if (ggufProgressGroup) ggufProgressGroup.classList.add('hidden');
        }
    }
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
    const apiKeyInput = document.getElementById('model-api-key');
    const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';

    if (!provider || !modelId || !connectionType) {
        saveBtn.disabled = true;
        return;
    }

    if (connectionType === 'browser-cloud') {
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
    const modelUrl = document.getElementById('model-url-input')?.value.trim() || null;
    const localPath = document.getElementById('local-path-input')?.value.trim() || null;
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
        keyId: keyId,
        modelUrl: modelUrl || null,
        localPath: localPath || null
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
    const modelUrlInput = document.getElementById('model-url-input');
    if (modelUrlInput) modelUrlInput.value = '';
    const localPathInput = document.getElementById('local-path-input');
    if (localPathInput) localPathInput.value = '';
    document.getElementById('model-select-group').classList.add('hidden');
    document.getElementById('connection-type-group').classList.add('hidden');
    document.getElementById('api-key-group').classList.add('hidden');
    const modelUrlGroup = document.getElementById('model-url-group');
    if (modelUrlGroup) modelUrlGroup.classList.add('hidden');
    const localPathGroup = document.getElementById('local-path-group');
    if (localPathGroup) localPathGroup.classList.add('hidden');
    const ggufImportGroup = document.getElementById('gguf-import-group');
    if (ggufImportGroup) ggufImportGroup.classList.add('hidden');
    const ggufProgressGroup = document.getElementById('gguf-import-progress');
    if (ggufProgressGroup) ggufProgressGroup.classList.add('hidden');
    document.getElementById('save-model-btn').disabled = true;
}

// Populate edit form
function populateeditForm(model) {
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

        // Restore model URL if present
        if (model.modelUrl) {
            const urlInput = document.getElementById('model-url-input');
            if (urlInput) urlInput.value = model.modelUrl;
        }

        // Restore local path if present
        if (model.localPath) {
            const pathInput = document.getElementById('local-path-input');
            if (pathInput) pathInput.value = model.localPath;
        }

        // Re-validate after a short delay to ensure all values are set
        setTimeout(() => validateForm(), 50);
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
        const triggerValidation = () => validateForm();
        apiKeyInput.addEventListener('input', triggerValidation);
        apiKeyInput.addEventListener('change', triggerValidation);
        apiKeyInput.addEventListener('keyup', triggerValidation);
        apiKeyInput.addEventListener('paste', () => setTimeout(triggerValidation, 10));
        // Handle autofill by polling on focus and animationstart (Chrome autofill triggers this)
        apiKeyInput.addEventListener('focus', () => {
            // Immediate check
            triggerValidation();
            // Poll for autofill
            const checkAutofill = setInterval(triggerValidation, 100);
            setTimeout(() => clearInterval(checkAutofill), 2000);
        });
        // Chrome autofill detection via animation
        apiKeyInput.addEventListener('animationstart', (e) => {
            if (e.animationName === 'onAutoFillStart' || e.animationName) {
                setTimeout(triggerValidation, 50);
            }
        });
    }

    const consensusSelect = document.getElementById('consensus-strategy');
    if (consensusSelect) {
        consensusSelect.addEventListener('change', () => {
            saveToStorage();
        });
    }

    // Click outside modal to close
    const overlay = document.getElementById('model-form-overlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            // Only close if clicking on the overlay itself, not the dialog
            if (e.target === overlay) {
                closeInlineForm();
            }
        });
    }

    // Escape key to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const overlay = document.getElementById('model-form-overlay');
            if (overlay && overlay.classList.contains('open')) {
                closeInlineForm();
            }
        }
    });

    // Check for URL parameters (from serve-cli auto-open)
    handleUrlParams();

    // Setup GGUF import listeners
    setupGGUFImportListeners();

    // Setup browse button listener
    setupBrowseListeners();
}

/**
 * Handle URL query parameters for auto-filling the form.
 * Used when serve-cli opens browser with ?provider=dreamer&modelUrl=...
 */
function handleUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get('provider');
    const modelUrl = params.get('modelUrl');

    if (provider === 'dreamer' && modelUrl) {
        console.log('[ModelConfig] URL params detected, auto-opening form with Dreamer + modelUrl');

        // Wait for providers to be detected, then open form
        setTimeout(() => {
            // Open the add model form
            openInlineForm();

            // Wait for form to open, then fill in values
            setTimeout(() => {
                // Select Dreamer provider
                const providerSelect = document.getElementById('provider-select');
                if (providerSelect) {
                    providerSelect.value = 'dreamer';
                    onProviderChange({ target: { value: 'dreamer' } });
                }

                // Fill in the model URL
                setTimeout(() => {
                    const urlInput = document.getElementById('model-url-input');
                    if (urlInput) {
                        urlInput.value = decodeURIComponent(modelUrl);
                    }
                }, 100);
            }, 100);
        }, 500);

        // Clear URL params to avoid re-triggering on refresh
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, '', cleanUrl);
    }
}

// ============================================================================
// GGUF Import Handling
// ============================================================================

let ggufImportController = null;

/**
 * Setup GGUF import button listener
 */
export function setupGGUFImportListeners() {
    const importBtn = document.getElementById('import-gguf-btn');
    const cancelBtn = document.getElementById('gguf-import-cancel');

    if (importBtn) {
        importBtn.addEventListener('click', handleGGUFImportClick);
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', handleGGUFImportCancel);
    }
}

/**
 * Handle GGUF import button click
 */
async function handleGGUFImportClick() {
    try {
        // Dynamically import the modules (lazy load)
        const { pickGGUFFile } = await import('../../../dreamer/browser/file-picker.js');
        const { importGGUFFile, ImportStage } = await import('../../../dreamer/browser/gguf-importer.js');

        // Pick file
        const file = await pickGGUFFile();
        if (!file) {
            console.log('[GGUF Import] User cancelled file picker');
            return;
        }

        console.log('[GGUF Import] Selected file:', file.name, 'Size:', (file.size / 1024 / 1024).toFixed(1), 'MB');

        // Show progress UI
        showImportProgress();

        // Create abort controller for cancellation
        ggufImportController = new AbortController();

        // Start import
        const modelId = await importGGUFFile(file, {
            onProgress: updateImportProgress,
            signal: ggufImportController.signal,
        });

        console.log('[GGUF Import] Complete! Model ID:', modelId);

        // Auto-add the model
        await autoAddImportedModel(modelId);

        // Hide progress UI
        hideImportProgress();

        // Close the form
        closeInlineForm();

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('[GGUF Import] Cancelled by user');
        } else {
            console.error('[GGUF Import] Error:', error);
            alert(`Import failed: ${error.message}`);
        }
        hideImportProgress();
    } finally {
        ggufImportController = null;
    }
}

/**
 * Handle cancel button click
 */
function handleGGUFImportCancel() {
    if (ggufImportController) {
        ggufImportController.abort();
        ggufImportController = null;
    }
    hideImportProgress();
}

/**
 * Show import progress UI
 */
function showImportProgress() {
    const importGroup = document.getElementById('gguf-import-group');
    const progressGroup = document.getElementById('gguf-import-progress');
    const progressBar = document.getElementById('gguf-import-progress-bar');
    const progressText = document.getElementById('gguf-import-progress-text');

    if (importGroup) importGroup.classList.add('hidden');
    if (progressGroup) progressGroup.classList.remove('hidden');
    if (progressBar) progressBar.value = 0;
    if (progressText) progressText.textContent = 'Starting...';
}

/**
 * Hide import progress UI
 */
function hideImportProgress() {
    const importGroup = document.getElementById('gguf-import-group');
    const progressGroup = document.getElementById('gguf-import-progress');

    if (progressGroup) progressGroup.classList.add('hidden');
    if (importGroup) importGroup.classList.remove('hidden');
}

/**
 * Update progress UI
 */
function updateImportProgress(progress) {
    const progressBar = document.getElementById('gguf-import-progress-bar');
    const progressText = document.getElementById('gguf-import-progress-text');

    if (progress.percent !== undefined && progressBar) {
        progressBar.value = progress.percent;
    }

    if (progressText) {
        switch (progress.stage) {
            case 'parsing':
                progressText.textContent = progress.message || 'Parsing header...';
                break;
            case 'sharding':
                progressText.textContent = progress.message || `${progress.percent || 0}%`;
                break;
            case 'writing':
                progressText.textContent = progress.message || 'Saving manifest...';
                break;
            case 'complete':
                progressText.textContent = 'Complete!';
                if (progressBar) progressBar.value = 100;
                break;
            case 'error':
                progressText.textContent = `Error: ${progress.message}`;
                break;
            default:
                progressText.textContent = progress.message || 'Processing...';
        }
    }
}

/**
 * Auto-add imported model to the model list
 */
async function autoAddImportedModel(modelId) {
    // Add model with minimal config - it's already in OPFS
    const modelConfig = {
        id: modelId,
        name: modelId,
        provider: 'dreamer',
        hostType: 'browser-local',
        queryMethod: 'browser',
        keySource: 'none',
        keyId: null,
        modelUrl: null, // No URL needed - model is in OPFS
        localPath: null,
        isImported: true, // Flag to indicate this was imported
    };

    if (!addModel(modelConfig)) {
        console.warn('[GGUF Import] Could not add model - max models reached?');
        return;
    }

    renderModelCards();
    saveToStorage();
    updateGoalInputState();

    console.log('[GGUF Import] Model added to list:', modelConfig);
}

// ========================================
// Native Bridge Browse Functionality
// ========================================

let browseClient = null;
let browseCurrentPath = '/Users';
let browseSelectedEntry = null;

/**
 * Setup browse button and modal listeners
 */
function setupBrowseListeners() {
    const browseBtn = document.getElementById('browse-path-btn');
    const closeBtn = document.getElementById('browse-modal-close');
    const cancelBtn = document.getElementById('browse-cancel-btn');
    const selectBtn = document.getElementById('browse-select-btn');
    const upBtn = document.getElementById('browse-up-btn');
    const goBtn = document.getElementById('browse-go-btn');
    const pathInput = document.getElementById('browse-current-path');
    const modal = document.getElementById('browse-modal');

    if (browseBtn) {
        browseBtn.addEventListener('click', openBrowseModal);
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', closeBrowseModal);
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeBrowseModal);
    }

    if (selectBtn) {
        selectBtn.addEventListener('click', selectBrowsePath);
    }

    if (upBtn) {
        upBtn.addEventListener('click', navigateUp);
    }

    if (goBtn) {
        goBtn.addEventListener('click', () => {
            const newPath = pathInput?.value;
            if (newPath) navigateToPath(newPath);
        });
    }

    if (pathInput) {
        pathInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                navigateToPath(pathInput.value);
            }
        });
    }

    // Click outside to close
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeBrowseModal();
        });
    }
}

/**
 * Open the browse modal
 */
async function openBrowseModal() {
    const modal = document.getElementById('browse-modal');
    if (!modal) return;

    // Initialize bridge client if needed
    if (!browseClient) {
        try {
            const { createBridgeClient } = await import('../../../dreamer/bridge/index.js');
            browseClient = await createBridgeClient();
        } catch (err) {
            console.error('[Browse] Failed to create bridge client:', err);
            alert('Failed to connect to Native Bridge. Make sure the extension is installed.');
            return;
        }
    }

    modal.classList.remove('hidden');
    browseSelectedEntry = null;

    // Load initial directory
    await navigateToPath(browseCurrentPath);
}

/**
 * Close the browse modal
 */
function closeBrowseModal() {
    const modal = document.getElementById('browse-modal');
    if (modal) modal.classList.add('hidden');
}

/**
 * Navigate to a path
 */
async function navigateToPath(path) {
    if (!browseClient) return;

    const entriesContainer = document.getElementById('browse-entries');
    const pathInput = document.getElementById('browse-current-path');

    if (entriesContainer) {
        entriesContainer.innerHTML = '<div class="browse-empty">Loading...</div>';
    }

    try {
        const entries = await browseClient.list(path);
        browseCurrentPath = path;
        browseSelectedEntry = null;

        if (pathInput) pathInput.value = path;

        renderBrowseEntries(entries);
    } catch (err) {
        console.error('[Browse] Failed to list directory:', err);
        if (entriesContainer) {
            entriesContainer.innerHTML = `<div class="browse-empty">Error: ${err.message}</div>`;
        }
    }
}

/**
 * Navigate up one directory
 */
function navigateUp() {
    const parts = browseCurrentPath.split('/').filter(Boolean);
    if (parts.length > 0) {
        parts.pop();
        const newPath = '/' + parts.join('/') || '/';
        navigateToPath(newPath);
    }
}

/**
 * Render directory entries
 */
function renderBrowseEntries(entries) {
    const container = document.getElementById('browse-entries');
    if (!container) return;

    if (!entries || entries.length === 0) {
        container.innerHTML = '<div class="browse-empty">Empty directory</div>';
        return;
    }

    container.innerHTML = entries.map(entry => `
        <div class="browse-entry ${entry.isDir ? 'browse-entry-dir' : ''}"
             data-name="${entry.name}"
             data-isdir="${entry.isDir}">
            <span class="browse-entry-icon">${entry.isDir ? '☗' : '☐'}</span>
            <span class="browse-entry-name">${entry.name}</span>
            <span class="browse-entry-size">${entry.isDir ? '' : formatSize(entry.size)}</span>
        </div>
    `).join('');

    // Add click handlers
    container.querySelectorAll('.browse-entry').forEach(el => {
        el.addEventListener('click', () => handleEntryClick(el));
        el.addEventListener('dblclick', () => handleEntryDblClick(el));
    });
}

/**
 * Handle single click on entry (select)
 */
function handleEntryClick(el) {
    // Deselect previous
    document.querySelectorAll('.browse-entry.selected').forEach(e => e.classList.remove('selected'));

    // Select this one
    el.classList.add('selected');
    browseSelectedEntry = {
        name: el.dataset.name,
        isDir: el.dataset.isdir === 'true',
    };
}

/**
 * Handle double click on entry (navigate into dir or select file)
 */
function handleEntryDblClick(el) {
    const name = el.dataset.name;
    const isDir = el.dataset.isdir === 'true';

    if (isDir) {
        const newPath = browseCurrentPath === '/' ? `/${name}` : `${browseCurrentPath}/${name}`;
        navigateToPath(newPath);
    } else {
        // Double-click file = select it
        browseSelectedEntry = { name, isDir: false };
        selectBrowsePath();
    }
}

/**
 * Select the current path/entry and close modal
 */
function selectBrowsePath() {
    let selectedPath = browseCurrentPath;

    if (browseSelectedEntry) {
        selectedPath = browseCurrentPath === '/'
            ? `/${browseSelectedEntry.name}`
            : `${browseCurrentPath}/${browseSelectedEntry.name}`;
    }

    // Set the path in the input
    const pathInput = document.getElementById('local-path-input');
    if (pathInput) {
        pathInput.value = selectedPath;
    }

    closeBrowseModal();
}

/**
 * Format file size
 */
function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
