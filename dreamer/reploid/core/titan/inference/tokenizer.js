/**
 * tokenizer.js - Tokenizer Wrapper
 *
 * Provides a unified interface for tokenization across different backends:
 * - Transformers.js tokenizers (from HuggingFace)
 * - SentencePiece WASM (for .model files)
 * - Simple BPE (fallback for basic models)
 *
 * @module inference/tokenizer
 */

/**
 * Tokenizer Configuration
 * @typedef {Object} TokenizerConfig
 * @property {'transformers' | 'sentencepiece' | 'bpe'} type - Tokenizer backend
 * @property {string} modelPath - Path to tokenizer model/vocab
 * @property {Object} specialTokens - Special token mappings
 */

/**
 * Abstract base tokenizer interface
 */
class BaseTokenizer {
  constructor(config = {}) {
    this.vocabSize = config.vocabSize || 32000;
    this.specialTokens = {
      pad: config.padToken ?? 0,
      bos: config.bosToken ?? 1,
      eos: config.eosToken ?? 2,
      unk: config.unkToken ?? 0,
      ...config.specialTokens
    };
    this.addBosToken = config.addBosToken !== false;
    this.addEosToken = config.addEosToken || false;
  }

  /**
   * Encode text to token IDs
   * @param {string} text
   * @returns {number[]}
   */
  encode(text) {
    throw new Error('encode() must be implemented by subclass');
  }

  /**
   * Decode token IDs to text
   * @param {number[]} ids
   * @returns {string}
   */
  decode(ids) {
    throw new Error('decode() must be implemented by subclass');
  }

  /**
   * Get vocabulary size
   * @returns {number}
   */
  getVocabSize() {
    return this.vocabSize;
  }

  /**
   * Check if token is special
   * @param {number} tokenId
   * @returns {boolean}
   */
  isSpecialToken(tokenId) {
    return Object.values(this.specialTokens).includes(tokenId);
  }
}

/**
 * Wrapper for Transformers.js tokenizer
 */
export class TransformersTokenizer extends BaseTokenizer {
  constructor(config = {}) {
    super(config);
    this.tokenizer = null;
    this.modelId = config.modelId;
  }

  /**
   * Initialize with a Transformers.js tokenizer instance
   * @param {Object} tokenizer - Transformers.js tokenizer
   */
  setTokenizer(tokenizer) {
    this.tokenizer = tokenizer;
    if (tokenizer.model?.vocab) {
      this.vocabSize = Object.keys(tokenizer.model.vocab).length;
    }
  }

  /**
   * Load tokenizer from HuggingFace model
   * @param {string} modelId - HuggingFace model ID
   */
  async load(modelId) {
    if (typeof window === 'undefined' || !window.transformers) {
      throw new Error('Transformers.js not loaded');
    }

    const { AutoTokenizer } = await import(
      'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3'
    );

    this.tokenizer = await AutoTokenizer.from_pretrained(modelId);
    this.modelId = modelId;

    // Update special tokens from loaded tokenizer
    if (this.tokenizer.special_tokens_map) {
      const map = this.tokenizer.special_tokens_map;
      if (map.pad_token) this.specialTokens.pad = this.tokenizer.pad_token_id;
      if (map.bos_token) this.specialTokens.bos = this.tokenizer.bos_token_id;
      if (map.eos_token) this.specialTokens.eos = this.tokenizer.eos_token_id;
      if (map.unk_token) this.specialTokens.unk = this.tokenizer.unk_token_id;
    }
  }

  encode(text) {
    if (!this.tokenizer) {
      throw new Error('Tokenizer not initialized');
    }

    const result = this.tokenizer.encode(text, {
      add_special_tokens: this.addBosToken
    });

    return Array.from(result);
  }

  decode(ids, skipSpecialTokens = true) {
    if (!this.tokenizer) {
      throw new Error('Tokenizer not initialized');
    }

    return this.tokenizer.decode(ids, { skip_special_tokens: skipSpecialTokens });
  }

  /**
   * Batch encode multiple texts
   * @param {string[]} texts
   * @returns {number[][]}
   */
  batchEncode(texts) {
    return texts.map(t => this.encode(t));
  }
}

/**
 * SentencePiece tokenizer using WASM
 * For models that provide .model files
 */
export class SentencePieceTokenizer extends BaseTokenizer {
  constructor(config = {}) {
    super(config);
    this.processor = null;
    this.modelData = null;
  }

  /**
   * Load SentencePiece model from ArrayBuffer
   * @param {ArrayBuffer} modelData - .model file content
   */
  async load(modelData) {
    // TODO: Load sentencepiece WASM module
    // For now, store model data for future implementation
    this.modelData = modelData;

    // Placeholder: in production, would initialize WASM module
    console.warn('SentencePiece WASM not yet implemented - using stub');
  }

  encode(text) {
    if (!this.modelData) {
      throw new Error('SentencePiece model not loaded');
    }

    // Stub implementation - in production would use WASM
    // For now, return simple byte-level encoding
    return this._fallbackEncode(text);
  }

  decode(ids) {
    if (!this.modelData) {
      throw new Error('SentencePiece model not loaded');
    }

    // Stub implementation
    return this._fallbackDecode(ids);
  }

  /**
   * Fallback byte-level encoding
   * @private
   */
  _fallbackEncode(text) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    const ids = [];

    if (this.addBosToken) {
      ids.push(this.specialTokens.bos);
    }

    for (const byte of bytes) {
      // Map bytes to token IDs (offset by special tokens)
      ids.push(byte + 256); // Assuming first 256 IDs are reserved
    }

    if (this.addEosToken) {
      ids.push(this.specialTokens.eos);
    }

    return ids;
  }

  /**
   * Fallback byte-level decoding
   * @private
   */
  _fallbackDecode(ids) {
    const bytes = [];

    for (const id of ids) {
      // Skip special tokens
      if (this.isSpecialToken(id)) continue;

      // Reverse the byte mapping
      if (id >= 256) {
        bytes.push(id - 256);
      }
    }

    const decoder = new TextDecoder();
    return decoder.decode(new Uint8Array(bytes));
  }
}

/**
 * Simple BPE tokenizer
 * For models with vocab.json + merges.txt
 */
export class BPETokenizer extends BaseTokenizer {
  constructor(config = {}) {
    super(config);
    this.vocab = new Map();
    this.reverseVocab = new Map();
    this.merges = [];
    this.mergeRanks = new Map();
  }

  /**
   * Load vocabulary and merges
   * @param {Object} vocab - Token to ID mapping
   * @param {string[]} merges - BPE merge rules
   */
  load(vocab, merges) {
    // Build vocab maps
    for (const [token, id] of Object.entries(vocab)) {
      this.vocab.set(token, id);
      this.reverseVocab.set(id, token);
    }

    this.vocabSize = this.vocab.size;

    // Build merge ranks
    this.merges = merges;
    for (let i = 0; i < merges.length; i++) {
      this.mergeRanks.set(merges[i], i);
    }
  }

  /**
   * Get pairs of adjacent symbols in word
   * @private
   */
  _getPairs(word) {
    const pairs = [];
    for (let i = 0; i < word.length - 1; i++) {
      pairs.push(`${word[i]} ${word[i + 1]}`);
    }
    return pairs;
  }

  /**
   * Apply BPE to a single word
   * @private
   */
  _bpe(word) {
    let tokens = word.split('');

    while (tokens.length > 1) {
      // Find the pair with lowest rank
      const pairs = this._getPairs(tokens);
      let minPair = null;
      let minRank = Infinity;

      for (const pair of pairs) {
        const rank = this.mergeRanks.get(pair);
        if (rank !== undefined && rank < minRank) {
          minRank = rank;
          minPair = pair;
        }
      }

      if (minPair === null) break;

      // Merge the pair
      const [first, second] = minPair.split(' ');
      const newTokens = [];
      let i = 0;

      while (i < tokens.length) {
        if (i < tokens.length - 1 &&
            tokens[i] === first &&
            tokens[i + 1] === second) {
          newTokens.push(first + second);
          i += 2;
        } else {
          newTokens.push(tokens[i]);
          i += 1;
        }
      }

      tokens = newTokens;
    }

    return tokens;
  }

  encode(text) {
    const ids = [];

    if (this.addBosToken) {
      ids.push(this.specialTokens.bos);
    }

    // Simple word-level tokenization then BPE
    // In production, would use proper pre-tokenization
    const words = text.split(/(\s+)/);

    for (const word of words) {
      if (word.trim() === '') {
        // Handle whitespace
        const wsToken = this.vocab.get(word);
        if (wsToken !== undefined) {
          ids.push(wsToken);
        }
        continue;
      }

      // Apply BPE
      const tokens = this._bpe(word);

      for (const token of tokens) {
        const id = this.vocab.get(token);
        if (id !== undefined) {
          ids.push(id);
        } else {
          // Unknown token
          ids.push(this.specialTokens.unk);
        }
      }
    }

    if (this.addEosToken) {
      ids.push(this.specialTokens.eos);
    }

    return ids;
  }

  decode(ids, skipSpecialTokens = true) {
    const tokens = [];

    for (const id of ids) {
      if (skipSpecialTokens && this.isSpecialToken(id)) {
        continue;
      }

      const token = this.reverseVocab.get(id);
      if (token !== undefined) {
        tokens.push(token);
      }
    }

    // Join tokens (handle special whitespace markers like Ġ)
    return tokens.join('')
      .replace(/Ġ/g, ' ')
      .replace(/Ċ/g, '\n')
      .trim();
  }
}

/**
 * Factory function to create appropriate tokenizer
 * @param {TokenizerConfig} config
 * @returns {BaseTokenizer}
 */
export function createTokenizer(config) {
  switch (config.type) {
    case 'transformers':
      return new TransformersTokenizer(config);
    case 'sentencepiece':
      return new SentencePieceTokenizer(config);
    case 'bpe':
      return new BPETokenizer(config);
    default:
      throw new Error(`Unknown tokenizer type: ${config.type}`);
  }
}

/**
 * Tokenizer wrapper that auto-detects backend from model manifest
 */
export class Tokenizer {
  constructor() {
    this.backend = null;
    this.config = null;
  }

  /**
   * Initialize from model manifest
   * @param {Object} manifest - Model manifest from .rpl format
   */
  async initialize(manifest) {
    const tokenizerConfig = manifest.tokenizer || {};

    if (tokenizerConfig.hfModel) {
      // Use Transformers.js for HuggingFace models
      this.backend = new TransformersTokenizer({
        modelId: tokenizerConfig.hfModel,
        ...tokenizerConfig
      });
      await this.backend.load(tokenizerConfig.hfModel);
    } else if (tokenizerConfig.sentencepieceModel) {
      // Load SentencePiece model
      this.backend = new SentencePieceTokenizer(tokenizerConfig);
      // TODO: Waiting on Agent-B for loadShard() to load tokenizer model
      // const modelData = await loadShard(tokenizerConfig.sentencepieceModel);
      // await this.backend.load(modelData);
    } else if (tokenizerConfig.vocab && tokenizerConfig.merges) {
      // BPE with vocab + merges
      this.backend = new BPETokenizer(tokenizerConfig);
      this.backend.load(tokenizerConfig.vocab, tokenizerConfig.merges);
    } else {
      throw new Error('No valid tokenizer configuration in manifest');
    }

    this.config = tokenizerConfig;
  }

  /**
   * Encode text to token IDs
   * @param {string} text
   * @returns {number[]}
   */
  encode(text) {
    if (!this.backend) {
      throw new Error('Tokenizer not initialized');
    }
    return this.backend.encode(text);
  }

  /**
   * Decode token IDs to text
   * @param {number[]} ids
   * @param {boolean} skipSpecialTokens
   * @returns {string}
   */
  decode(ids, skipSpecialTokens = true) {
    if (!this.backend) {
      throw new Error('Tokenizer not initialized');
    }
    return this.backend.decode(ids, skipSpecialTokens);
  }

  /**
   * Get special tokens
   * @returns {Object}
   */
  getSpecialTokens() {
    return this.backend?.specialTokens || {};
  }

  /**
   * Get vocabulary size
   * @returns {number}
   */
  getVocabSize() {
    return this.backend?.getVocabSize() || 0;
  }
}

export default Tokenizer;
