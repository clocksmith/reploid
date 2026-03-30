/**
 * @fileoverview Transformers.js Client
 * Browser-native inference using Hugging Face Transformers.js with WebGPU/WASM.
 * Supports newer models like Qwen3, Gemma3, DeepSeek-R1 that aren't in WebLLM.
 */

const TransformersClient = {
  metadata: {
    id: 'TransformersClient',
    version: '1.0.0',
    genesis: { introduced: 'cognition' },
    dependencies: ['Utils', 'EventBus'],
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger, Errors } = Utils;

    // State
    let _generator = null;
    let _currentModelId = null;
    let _loaderPromise = null;

    // Model configurations for Transformers.js
    const modelConfigs = {
      // Qwen3 models
      'qwen3-0.6b': {
        hfId: 'onnx-community/Qwen3-0.6B-ONNX',
        dtype: 'q4',
        device: 'webgpu'
      },
      'qwen3-1.7b': {
        hfId: 'onnx-community/Qwen3-1.7B-ONNX',
        dtype: 'q4',
        device: 'webgpu'
      },
      // Gemma3 models
      'gemma3-1b': {
        hfId: 'onnx-community/gemma-3-1b-it-ONNX',
        dtype: 'q4',
        device: 'webgpu'
      },
      // SmolLM2
      'smollm2-360m': {
        hfId: 'HuggingFaceTB/SmolLM2-360M-Instruct',
        dtype: 'fp16',
        device: 'webgpu'
      },
      'smollm2-1.7b': {
        hfId: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',
        dtype: 'q4',
        device: 'webgpu'
      },
      // DeepSeek-R1 distilled
      'deepseek-r1-1.5b': {
        hfId: 'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX',
        dtype: 'q4',
        device: 'webgpu'
      },
      // Phi-4-mini
      'phi4-mini': {
        hfId: 'onnx-community/Phi-4-mini-instruct-ONNX',
        dtype: 'q4',
        device: 'webgpu'
      }
    };

    const ensureTransformersReady = async () => {
      if (typeof window === 'undefined') {
        throw new Errors.ConfigError('Transformers.js is only available in browser environments');
      }

      if (window.transformers) return window.transformers;
      if (_loaderPromise) return _loaderPromise;

      _loaderPromise = import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3')
        .then(mod => {
          window.transformers = {
            pipeline: mod.pipeline,
            env: mod.env
          };
          // Configure for WebGPU
          mod.env.backends.onnx.wasm.proxy = false;
          return window.transformers;
        })
        .catch((err) => {
          _loaderPromise = null;
          logger.error('[Transformers] Failed to load runtime', err);
          throw new Errors.ConfigError('Failed to load Transformers.js runtime');
        });

      return _loaderPromise;
    };

    const loadModel = async (modelId) => {
      await ensureTransformersReady();

      const config = modelConfigs[modelId];
      if (!config) {
        throw new Errors.ConfigError(`Unknown Transformers.js model: ${modelId}`);
      }

      if (_currentModelId === modelId && _generator) {
        logger.info(`[Transformers] Model ${modelId} already loaded`);
        return;
      }

      logger.info(`[Transformers] Loading model: ${config.hfId}`);

      // Throttle progress updates - only emit on 5% changes
      let lastReportedPercent = -1;

      try {
        // Dispose previous generator if exists
        if (_generator && _generator.dispose) {
          await _generator.dispose();
        }

        // Emit downloading state
        EventBus.emit('agent:status', {
          state: 'DOWNLOADING',
          activity: `Downloading model: ${modelId}`,
          progress: 0
        });

        _generator = await window.transformers.pipeline(
          'text-generation',
          config.hfId,
          {
            device: config.device,
            dtype: config.dtype,
            progress_callback: (progress) => {
              if (progress.status === 'progress' && progress.total > 0) {
                const percent = Math.round((progress.loaded / progress.total) * 100);
                // Only emit if percent changed by 5% or more
                if (percent - lastReportedPercent >= 5 || percent === 100) {
                  lastReportedPercent = percent;
                  const shortFile = progress.file?.split('/').pop() || 'model';
                  EventBus.emit('agent:status', {
                    state: 'DOWNLOADING',
                    activity: `Downloading ${shortFile}: ${percent}%`,
                    progress: percent
                  });
                }
              }
            }
          }
        );

        _currentModelId = modelId;
        logger.info(`[Transformers] Model ${modelId} loaded successfully`);
      } catch (err) {
        logger.error(`[Transformers] Failed to load model ${modelId}`, err);
        _generator = null;
        _currentModelId = null;
        const reason = err?.message || err?.cause?.message || err?.toString() || 'Unknown error';
        throw new Errors.ApiError(`Failed to load model: ${reason}`, 500);
      }
    };

    const chat = async (messages, modelConfig, onUpdate) => {
      const modelId = modelConfig.transformersModelId || modelConfig.id;

      await loadModel(modelId);

      // Format messages for text generation
      // Transformers.js text-generation expects a single prompt string
      const prompt = formatMessagesForGeneration(messages);

      logger.info(`[Transformers] Generating response for ${modelId}`);

      try {
        let fullContent = '';

        if (onUpdate) {
          // Streaming mode using callback
          const streamer = {
            put: (tokens) => {
              const text = _generator.tokenizer.decode(tokens, { skip_special_tokens: true });
              if (text) {
                fullContent += text;
                onUpdate(text);
              }
            },
            end: () => {}
          };

          await _generator(prompt, {
            max_new_tokens: 2048,
            temperature: 0.7,
            do_sample: true,
            streamer
          });
        } else {
          // Non-streaming mode
          const output = await _generator(prompt, {
            max_new_tokens: 2048,
            temperature: 0.7,
            do_sample: true,
            return_full_text: false
          });

          fullContent = output[0].generated_text;
        }

        return {
          requestId: Utils.generateId('tfjs'),
          content: stripThoughts(fullContent),
          raw: fullContent,
          model: modelId,
          timestamp: Date.now(),
          provider: 'transformers'
        };

      } catch (err) {
        logger.error('[Transformers] Generation error', err);
        const reason = err?.message || err?.cause?.message || err?.toString() || 'Unknown error';
        throw new Errors.ApiError(`Transformers.js generation failed: ${reason}`, 500);
      }
    };

    const formatMessagesForGeneration = (messages) => {
      // Convert chat messages to a single prompt string
      // Using ChatML-like format that most models understand
      let prompt = '';

      for (const msg of messages) {
        if (msg.role === 'system') {
          prompt += `<|system|>\n${msg.content}\n`;
        } else if (msg.role === 'user') {
          prompt += `<|user|>\n${msg.content}\n`;
        } else if (msg.role === 'assistant') {
          prompt += `<|assistant|>\n${msg.content}\n`;
        }
      }

      // Add final assistant tag to prompt generation
      prompt += '<|assistant|>\n';

      return prompt;
    };

    const stripThoughts = (text) => {
      return text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .trim();
    };

    const getStatus = () => {
      return {
        loaded: !!_generator,
        model: _currentModelId,
        available: typeof window !== 'undefined' && !!navigator.gpu
      };
    };

    const getAvailableModels = () => {
      return Object.entries(modelConfigs).map(([id, config]) => ({
        id,
        hfId: config.hfId,
        dtype: config.dtype
      }));
    };

    const unload = async () => {
      if (_generator && _generator.dispose) {
        await _generator.dispose();
      }
      _generator = null;
      _currentModelId = null;
      logger.info('[Transformers] Model unloaded');
    };

    return {
      chat,
      loadModel,
      getStatus,
      getAvailableModels,
      unload,
      isTransformersModel: (id) => id in modelConfigs || id.startsWith('transformers:')
    };
  }
};

export default TransformersClient;
