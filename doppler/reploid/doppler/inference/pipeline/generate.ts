/**
 * Main token generation loop.
 *
 * Orchestrates prefill, decode, and stop conditions for text generation.
 */

import type { LayerContext } from './layer.js';
import type { PrefillOptions } from './prefill.js';
import type { DecodeOptions } from './decode.js';
import type { StopCondition } from './stopping.js';

/**
 * Generation options.
 */
export interface GenerateOptions {
  /** Maximum tokens to generate */
  maxTokens: number;
  /** Sampling temperature (0 = greedy) */
  temperature: number;
  /** Top-k sampling (0 = disabled) */
  topK: number;
  /** Top-p (nucleus) sampling */
  topP: number;
  /** Repetition penalty */
  repetitionPenalty: number;
  /** Stop sequences */
  stopSequences?: string[];
  /** Enable speculative decoding */
  useSpeculative?: boolean;
  /** Apply chat template (for Gemma models) */
  useChatTemplate?: boolean;
  /** Token callback */
  onToken?: (tokenId: number, text: string) => void;
  /** Debug mode */
  debug?: boolean;
}

/**
 * Generation result.
 */
export interface GenerationResult {
  /** All generated token IDs (including prompt) */
  tokens: number[];
  /** Generated text (excluding prompt) */
  text: string;
  /** Finish reason */
  finishReason: 'stop' | 'length' | 'eos';
  /** Statistics */
  stats: {
    prefillTimeMs: number;
    decodeTimeMs: number;
    totalTimeMs: number;
    tokensGenerated: number;
  };
}

/**
 * Token stream event.
 */
export type TokenEvent = {
  type: 'token';
  token: string;
  tokenId: number;
} | {
  type: 'done';
  result: GenerationResult;
} | {
  type: 'error';
  error: Error;
};

/**
 * Generate tokens from prompt.
 *
 * This is the main generation loop that orchestrates:
 *   1. Tokenization
 *   2. Optional chat template application
 *   3. Prefill phase (process prompt)
 *   4. Decode phase (generate tokens one by one)
 *   5. Stop condition evaluation
 *   6. Token streaming
 *
 * @param prompt - Input text prompt
 * @param tokenizer - Tokenizer instance
 * @param context - Layer processing context
 * @param options - Generation options
 * @yields Generated tokens as they are produced
 */
export async function* generate(
  prompt: string,
  tokenizer: any,
  context: LayerContext,
  options: GenerateOptions
): AsyncGenerator<string, GenerationResult, void> {
  const startTime = performance.now();

  try {
    // Apply chat template if requested (e.g., Gemma format)
    let processedPrompt = prompt;
    if (options.useChatTemplate && (context.config as any).isGemma) {
      processedPrompt = applyGemmaChatTemplate(prompt);
      if (options.debug) {
        console.log('[Pipeline] Applied Gemma chat template');
      }
    }

    // Encode prompt
    const inputIds = tokenizer.encode(processedPrompt);
    let generatedIds = [...inputIds];

    if (options.debug) {
      console.log('[Pipeline] ========== INPUT ==========');
      console.log('[Pipeline] User query:', JSON.stringify(prompt));
      console.log('[Pipeline] Full text to LLM:');
      console.log(processedPrompt);
      console.log('[Pipeline] ============================');
      console.log('[Pipeline] Tokens:', inputIds.length, 'chars:', processedPrompt.length);
    }

    // Import pipeline functions
    const { prefill } = await import('./prefill.js');
    const { decodeStep } = await import('./decode.js');
    const { createStopCondition, isStopToken } = await import('./stopping.js');
    const { sample, applyRepetitionPenalty, logitsSanity } = await import('./sampling.js');

    // Create stop condition
    const stopCondition = createStopCondition({
      maxTokens: options.maxTokens,
      stopTokenIds: (context.config as any).stopTokenIds || [],
      eosTokenId: tokenizer.getSpecialTokens?.()?.eos,
      stopSequences: options.stopSequences,
    });

    // Prefill phase
    const prefillStart = performance.now();
    const prefillOpts: PrefillOptions = {
      useBatched: false,
      debug: options.debug,
      decode: (ids) => tokenizer.decode?.(ids) || '?',
    };

    const prefillResult = await prefill(inputIds, context, prefillOpts);
    const prefillTimeMs = performance.now() - prefillStart;

    if (options.debug) {
      logitsSanity(prefillResult.lastPosLogits, 'Prefill', prefillOpts.decode);
    }

    // Sample first token from prefill logits
    applyRepetitionPenalty(prefillResult.lastPosLogits, generatedIds, options.repetitionPenalty);
    const firstToken = sample(prefillResult.lastPosLogits, {
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      debug: options.debug,
      decode: prefillOpts.decode,
    });

    generatedIds.push(firstToken);

    // Decode phase
    const decodeStart = performance.now();
    let tokensGenerated = 1;

    // Yield first token
    const firstTokenText = tokenizer.decode([firstToken], true, false);
    if (options.debug) {
      console.log('[Pipeline] First token:', {
        id: firstToken,
        text: firstTokenText,
        seqLen: context.currentSeqLen,
      });
    }

    yield firstTokenText;

    if (options.onToken) {
      options.onToken(firstToken, firstTokenText);
    }

    // Check if first token triggers stop
    const eos = tokenizer.getSpecialTokens?.()?.eos;
    const stopTokenIds = (context.config as any).stopTokenIds || [];
    let shouldStop = isStopToken(firstToken, stopTokenIds, eos);

    // Generation loop
    while (tokensGenerated < options.maxTokens && !shouldStop) {
      const decodeOpts: DecodeOptions = {
        temperature: options.temperature,
        topP: options.topP,
        topK: options.topK,
        repetitionPenalty: options.repetitionPenalty,
        useBatched: false,
        debug: options.debug,
        decode: prefillOpts.decode,
      };

      const result = await decodeStep(generatedIds, context, decodeOpts);
      const token = result.nextToken;

      generatedIds.push(token);
      tokensGenerated++;

      // Decode and yield token
      const tokenText = tokenizer.decode([token], true, false);
      if (options.debug && (tokensGenerated <= 10 || tokensGenerated % 25 === 0)) {
        console.log('[Pipeline] Token:', {
          index: tokensGenerated,
          id: token,
          text: tokenText,
          seqLen: context.currentSeqLen,
        });
      }

      yield tokenText;

      if (options.onToken) {
        options.onToken(token, tokenText);
      }

      // Check stop conditions
      if (isStopToken(token, stopTokenIds, eos)) {
        shouldStop = true;
        break;
      }

      // Check sequence stop conditions
      if (stopCondition.check(generatedIds, tokenText)) {
        shouldStop = true;
        break;
      }
    }

    const decodeTimeMs = performance.now() - decodeStart;
    const totalTimeMs = performance.now() - startTime;

    // Generate output
    const outputIds = generatedIds.slice(inputIds.length);
    const outputText = tokenizer.decode(outputIds, false);

    if (options.debug) {
      console.log('[Pipeline] ========== OUTPUT ==========');
      console.log('[Pipeline] Generated', outputIds.length, 'tokens:', outputIds.join(', '));
      console.log('[Pipeline] Output text:');
      console.log(outputText);
      console.log('[Pipeline] =============================');
    }

    const finishReason: 'stop' | 'length' | 'eos' = shouldStop
      ? 'stop'
      : tokensGenerated >= options.maxTokens
      ? 'length'
      : 'eos';

    return {
      tokens: generatedIds,
      text: outputText,
      finishReason,
      stats: {
        prefillTimeMs,
        decodeTimeMs,
        totalTimeMs,
        tokensGenerated,
      },
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Apply Gemma chat template to prompt.
 * Format: <bos><start_of_turn>user\n{prompt}<end_of_turn>\n<start_of_turn>model\n
 */
function applyGemmaChatTemplate(prompt: string): string {
  const userTurn = `<start_of_turn>user\n${prompt}<end_of_turn>\n`;
  const modelTurn = `<start_of_turn>model\n`;
  return userTurn + modelTurn;
}
