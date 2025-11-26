// Provider Detection and Model Catalogs
import { getAvailableProviders, setAvailableProviders } from './state.js';

// Transformers.js models (browser-native with WebGPU)
export const transformersModels = [
    { id: 'qwen3-0.6b', name: 'Qwen3 0.6B', vram: 800, context: 32768 },
    { id: 'qwen3-1.7b', name: 'Qwen3 1.7B', vram: 2000, context: 32768 },
    { id: 'gemma3-1b', name: 'Gemma3 1B', vram: 1500, context: 8192 },
    { id: 'smollm2-360m', name: 'SmolLM2 360M', vram: 400, context: 8192 },
    { id: 'smollm2-1.7b', name: 'SmolLM2 1.7B', vram: 2000, context: 8192 },
    { id: 'deepseek-r1-1.5b', name: 'DeepSeek-R1 1.5B', vram: 2000, context: 32768 },
    { id: 'phi4-mini', name: 'Phi-4 Mini', vram: 4000, context: 16384 }
];

// Cloud provider model catalogs (updated Nov 2025)
export const cloudProviders = {
    gemini: {
        name: 'Gemini',
        models: [
            { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash (Exp)' },
            { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
            { id: 'gemini-1.5-flash-8b', name: 'Gemini 1.5 Flash 8B' },
            { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }
        ],
        requiresKey: true,
        hostType: 'browser-cloud'
    },
    openai: {
        name: 'OpenAI',
        models: [
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
            { id: 'gpt-4o', name: 'GPT-4o' },
            { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
            { id: 'o1-mini', name: 'O1 Mini' },
            { id: 'o1-preview', name: 'O1 Preview' }
        ],
        requiresKey: true,
        hostType: 'browser-cloud'
    },
    anthropic: {
        name: 'Anthropic',
        models: [
            { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
            { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
            { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' }
        ],
        requiresKey: true,
        hostType: 'browser-cloud'
    }
};

// Fallback WebLLM models (f32 for broader compatibility)
const fallbackWebLLMModels = [
    { id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', name: 'Llama 3.2 1B', vram: 1500, context: 131072 },
    { id: 'Llama-3.2-3B-Instruct-q4f32_1-MLC', name: 'Llama 3.2 3B', vram: 3000, context: 131072 },
    { id: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC', name: 'Qwen 0.5B', vram: 600, context: 32768 },
    { id: 'SmolLM2-360M-Instruct-q4f32_1-MLC', name: 'SmolLM2 360M', vram: 400, context: 8192 },
    { id: 'TinyLlama-1.1B-Chat-v1.0-q4f32_1-MLC', name: 'TinyLlama 1.1B', vram: 1100, context: 2048 }
].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

// Additional models not in WebLLM 0.2.79 prebuilt config
const additionalWebLLMModels = [
    // Qwen3 models (May 2025)
    { model_id: 'Qwen3-0.6B-q4f32_1-MLC', vram_required_MB: 800, context_window_size: 32768 },
    { model_id: 'Qwen3-1.7B-q4f32_1-MLC', vram_required_MB: 2000, context_window_size: 32768 },
    { model_id: 'Qwen3-4B-q4f32_1-MLC', vram_required_MB: 4000, context_window_size: 32768 },
    { model_id: 'Qwen3-8B-q4f32_1-MLC', vram_required_MB: 6000, context_window_size: 32768 },
    { model_id: 'Qwen3-0.6B-q4f16_1-MLC', vram_required_MB: 600, context_window_size: 32768 },
    { model_id: 'Qwen3-1.7B-q4f16_1-MLC', vram_required_MB: 1500, context_window_size: 32768 },
    { model_id: 'Qwen3-4B-q4f16_1-MLC', vram_required_MB: 3000, context_window_size: 32768 },
    { model_id: 'Qwen3-8B-q4f16_1-MLC', vram_required_MB: 5000, context_window_size: 32768 },
];

// Get WebLLM models from runtime config
async function getWebLLMModels() {
    // Wait for WebLLM to load with timeout
    const maxWaitMs = 5000;
    const startTime = Date.now();
    let retries = 0;

    while (!window.webllm && (Date.now() - startTime) < maxWaitMs) {
        await new Promise(r => setTimeout(r, 100));
        retries++;
    }

    if (!window.webllm?.prebuiltAppConfig?.model_list) {
        const elapsed = Date.now() - startTime;
        console.warn(`[ModelConfig] WebLLM prebuiltAppConfig not available after ${retries} retries (${elapsed}ms)`);
        return [];
    }

    // Merge prebuilt models with additional newer models
    const prebuiltList = window.webllm.prebuiltAppConfig.model_list;
    const existingIds = new Set(prebuiltList.map(m => m.model_id));
    const newModels = additionalWebLLMModels.filter(m => !existingIds.has(m.model_id));
    const modelList = [...prebuiltList, ...newModels];

    console.log(`[ModelConfig] Found ${prebuiltList.length} prebuilt + ${newModels.length} additional models`);

    return modelList
        .filter(m => {
            const hasValidId = m.model_id && typeof m.model_id === 'string';
            const vramMB = m.vram_required_MB || 0;
            const isTooLarge = vramMB > 10000;
            return hasValidId && !isTooLarge;
        })
        .map(m => {
            let displayName = m.model_id;
            const quantMatch = m.model_id.match(/q\d+f\d+/i);
            const quant = quantMatch ? quantMatch[0] : '';

            displayName = displayName.replace(/-q\w+[-_]\d+-MLC$/i, '');
            displayName = displayName.replace(/-MLC$/i, '');
            displayName = displayName.replace(/[-_]/g, ' ');

            if (quant) {
                displayName = `${displayName} [${quant}]`;
            }

            return {
                id: m.model_id,
                name: displayName,
                vram: m.vram_required_MB || 0,
                context: m.context_window_size || 4096
            };
        })
        .sort((a, b) => a.vram - b.vram);
}

// Check availability of all providers
export async function checkAvailability() {
    const providers = getAvailableProviders();
    const proxyUrl = window.location.origin.includes('file://')
        ? 'http://localhost:8000'
        : window.location.origin;

    // Check Ollama
    try {
        const response = await fetch(`${proxyUrl}/api/ollama/models`, {
            signal: AbortSignal.timeout(3000)
        });
        if (response.ok) {
            const data = await response.json();
            providers.ollama.online = true;
            providers.ollama.models = (data.models || []).map(m => ({
                id: m.name || m.model,
                name: m.name || m.model
            }));
        } else {
            console.log(`[ModelConfig] Ollama API returned ${response.status} - this is normal if running without local proxy`);
        }
    } catch (error) {
        console.log('[ModelConfig] Ollama not available (expected when hosted):', error.message);
    }

    // Check WebGPU
    providers.webgpu.online = !!navigator.gpu;
    if (providers.webgpu.online) {
        try {
            const webllmModels = await getWebLLMModels();
            if (webllmModels.length > 0) {
                providers.webgpu.models = webllmModels;
                console.log(`[ModelConfig] Loaded ${webllmModels.length} models from WebLLM catalog`);
            } else {
                throw new Error('No models in WebLLM catalog');
            }
        } catch (error) {
            console.warn('[ModelConfig] Could not load WebLLM catalog, using fallback list:', error.message);
            providers.webgpu.models = fallbackWebLLMModels;
        }

        // Also enable Transformers.js since it uses WebGPU
        providers.transformers.online = true;
        providers.transformers.models = transformersModels;
        console.log(`[ModelConfig] Transformers.js available with ${transformersModels.length} models`);
    }

    // Check Proxy
    try {
        const response = await fetch(`${proxyUrl}/api/health`, {
            signal: AbortSignal.timeout(3000)
        });
        if (response.ok) {
            providers.proxy.online = true;
        } else {
            console.log(`[ModelConfig] Proxy health check returned ${response.status} - this is normal if running without local proxy`);
            providers.proxy.online = false;
        }
    } catch (error) {
        console.log('[ModelConfig] Proxy not available (expected when hosted):', error.message);
    }

    setAvailableProviders(providers);
}

// Get models for a specific provider
export function getModelsForProvider(provider) {
    const providers = getAvailableProviders();

    if (provider === 'ollama') {
        return providers.ollama.models;
    } else if (provider === 'webllm') {
        return providers.webgpu.models;
    } else if (provider === 'transformers') {
        return providers.transformers.models;
    } else if (cloudProviders[provider]) {
        return cloudProviders[provider].models;
    }
    return [];
}

// Get connection options for a provider
export function getConnectionOptions(provider) {
    const providers = getAvailableProviders();
    const options = [];

    if (provider === 'ollama') {
        options.push('proxy-local');
    } else if (provider === 'webllm') {
        options.push('browser-local');
    } else if (provider === 'transformers') {
        options.push('browser-local');
    } else if (cloudProviders[provider]) {
        // Browser-cloud (direct API) is always available
        options.push('browser-cloud');
        // Proxy-cloud only if proxy server is running
        if (providers.proxy.online) {
            options.push('proxy-cloud');
        }
    }

    return options;
}
