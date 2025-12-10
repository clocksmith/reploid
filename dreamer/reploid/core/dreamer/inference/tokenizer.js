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
 * SentencePiece tokenizer using pure JavaScript implementation
 * For models that provide .model files (protobuf format)
 *
 * Supports Unigram and BPE algorithms commonly used in LLMs like LLaMA.
 */
export class SentencePieceTokenizer extends BaseTokenizer {
  constructor(config = {}) {
    super(config);
    this.modelData = null;
    this.pieces = new Map();       // token string -> {id, score}
    this.reverseVocab = new Map(); // id -> token string
    this.algorithm = 'unigram';    // 'unigram' or 'bpe'
    this.byteTokens = new Map();   // byte fallback tokens
    this.unkId = 0;
  }

  /**
   * Load SentencePiece model from ArrayBuffer
   * @param {ArrayBuffer} modelData - .model file content (protobuf)
   */
  async load(modelData) {
    this.modelData = modelData;

    try {
      // Parse the SentencePiece model protobuf
      await this._parseModelProto(modelData);
      console.log(`[SentencePiece] Loaded ${this.pieces.size} pieces (${this.algorithm})`);
    } catch (err) {
      console.warn('[SentencePiece] Failed to parse model, using byte fallback:', err.message);
      this._initByteFallback();
    }
  }

  /**
   * Parse SentencePiece model protobuf format
   * SentencePiece uses a simple protobuf schema we can parse manually
   * @private
   */
  async _parseModelProto(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let offset = 0;

    // SentencePiece model is a protobuf with:
    // - Field 1: trainer_spec
    // - Field 2: normalizer_spec
    // - Field 3: repeated SentencePiece pieces

    while (offset < bytes.length) {
      // Read varint tag
      const { value: tag, newOffset: tagOffset } = this._readVarint(bytes, offset);
      offset = tagOffset;

      const fieldNumber = tag >> 3;
      const wireType = tag & 0x7;

      if (fieldNumber === 1 || fieldNumber === 2) {
        // Skip trainer_spec and normalizer_spec (wire type 2 = length-delimited)
        if (wireType === 2) {
          const { value: length, newOffset } = this._readVarint(bytes, offset);
          offset = newOffset + length;
        }
      } else if (fieldNumber === 3 && wireType === 2) {
        // SentencePiece entry
        const { value: length, newOffset } = this._readVarint(bytes, offset);
        offset = newOffset;

        const pieceData = bytes.slice(offset, offset + length);
        this._parsePiece(pieceData);
        offset += length;
      } else {
        // Skip unknown field
        if (wireType === 0) {
          const { newOffset } = this._readVarint(bytes, offset);
          offset = newOffset;
        } else if (wireType === 2) {
          const { value: length, newOffset } = this._readVarint(bytes, offset);
          offset = newOffset + length;
        } else if (wireType === 5) {
          offset += 4;
        } else if (wireType === 1) {
          offset += 8;
        } else {
          break; // Unknown wire type, stop parsing
        }
      }
    }

    // Set up special tokens
    this.unkId = this.specialTokens.unk;

    // Determine algorithm from model characteristics
    // (Unigram has scores, BPE typically doesn't)
    const hasScores = [...this.pieces.values()].some(p => p.score !== 0);
    this.algorithm = hasScores ? 'unigram' : 'bpe';
  }

  /**
   * Parse a single SentencePiece entry
   * @private
   */
  _parsePiece(bytes) {
    let offset = 0;
    let piece = '';
    let score = 0;
    let type = 1; // NORMAL by default

    while (offset < bytes.length) {
      const { value: tag, newOffset: tagOffset } = this._readVarint(bytes, offset);
      offset = tagOffset;

      const fieldNumber = tag >> 3;
      const wireType = tag & 0x7;

      if (fieldNumber === 1 && wireType === 2) {
        // piece string
        const { value: length, newOffset } = this._readVarint(bytes, offset);
        offset = newOffset;
        piece = new TextDecoder().decode(bytes.slice(offset, offset + length));
        offset += length;
      } else if (fieldNumber === 2 && wireType === 5) {
        // score (float32)
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
        score = view.getFloat32(0, true);
        offset += 4;
      } else if (fieldNumber === 3 && wireType === 0) {
        // type (varint enum)
        const { value, newOffset } = this._readVarint(bytes, offset);
        type = value;
        offset = newOffset;
      } else {
        // Skip unknown
        if (wireType === 0) {
          const { newOffset } = this._readVarint(bytes, offset);
          offset = newOffset;
        } else if (wireType === 2) {
          const { value: length, newOffset } = this._readVarint(bytes, offset);
          offset = newOffset + length;
        } else {
          break;
        }
      }
    }

    if (piece) {
      const id = this.pieces.size;
      this.pieces.set(piece, { id, score, type });
      this.reverseVocab.set(id, piece);
      this.vocabSize = this.pieces.size;

      // Track byte tokens (▁ prefix tokens and <0xXX> byte tokens)
      if (piece.match(/^<0x[0-9A-Fa-f]{2}>$/)) {
        const byteVal = parseInt(piece.slice(3, 5), 16);
        this.byteTokens.set(byteVal, id);
      }
    }
  }

  /**
   * Read a protobuf varint
   * @private
   */
  _readVarint(bytes, offset) {
    let value = 0;
    let shift = 0;
    let byte;

    do {
      if (offset >= bytes.length) {
        throw new Error('Unexpected end of buffer');
      }
      byte = bytes[offset++];
      value |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);

    return { value, newOffset: offset };
  }

  /**
   * Initialize byte-level fallback vocabulary
   * @private
   */
  _initByteFallback() {
    // Create a basic byte-level vocabulary
    // Special tokens
    this.pieces.set('<unk>', { id: 0, score: 0, type: 2 });
    this.pieces.set('<s>', { id: 1, score: 0, type: 3 });
    this.pieces.set('</s>', { id: 2, score: 0, type: 3 });
    this.reverseVocab.set(0, '<unk>');
    this.reverseVocab.set(1, '<s>');
    this.reverseVocab.set(2, '</s>');

    // Byte tokens (3-258)
    for (let i = 0; i < 256; i++) {
      const token = `<0x${i.toString(16).padStart(2, '0').toUpperCase()}>`;
      const id = i + 3;
      this.pieces.set(token, { id, score: 0, type: 6 }); // BYTE type
      this.reverseVocab.set(id, token);
      this.byteTokens.set(i, id);
    }

    this.vocabSize = this.pieces.size;
  }

  /**
   * Encode text using Unigram or BPE algorithm
   */
  encode(text) {
    if (!this.modelData && this.pieces.size === 0) {
      throw new Error('SentencePiece model not loaded');
    }

    const ids = [];

    if (this.addBosToken) {
      ids.push(this.specialTokens.bos);
    }

    // Normalize: add sentence piece prefix (▁ for word start)
    const normalized = text.replace(/ /g, '▁');
    const prefixed = (text.startsWith(' ') ? '' : '▁') + normalized;

    if (this.algorithm === 'unigram') {
      ids.push(...this._encodeUnigram(prefixed));
    } else {
      ids.push(...this._encodeBPE(prefixed));
    }

    if (this.addEosToken) {
      ids.push(this.specialTokens.eos);
    }

    return ids;
  }

  /**
   * Unigram encoding using Viterbi algorithm
   * @private
   */
  _encodeUnigram(text) {
    const n = text.length;
    if (n === 0) return [];

    // Viterbi: best[i] = {score, prev, tokenLen} for position i
    const best = new Array(n + 1).fill(null);
    best[0] = { score: 0, prev: -1, tokenLen: 0 };

    for (let i = 0; i < n; i++) {
      if (best[i] === null) continue;

      // Try all possible tokens starting at position i
      for (let len = 1; len <= Math.min(n - i, 32); len++) {
        const substr = text.slice(i, i + len);
        const piece = this.pieces.get(substr);

        if (piece) {
          const newScore = best[i].score + piece.score;
          if (best[i + len] === null || newScore > best[i + len].score) {
            best[i + len] = { score: newScore, prev: i, tokenLen: len };
          }
        }
      }

      // Byte fallback for single character
      if (best[i + 1] === null) {
        const charCode = text.charCodeAt(i);
        const bytes = new TextEncoder().encode(text[i]);
        // Use byte tokens with a penalty score
        const byteScore = best[i].score - 10 * bytes.length;
        best[i + 1] = { score: byteScore, prev: i, tokenLen: 1, isBytes: true, bytes };
      }
    }

    // Backtrack to get tokens
    const tokens = [];
    let pos = n;
    while (pos > 0) {
      const state = best[pos];
      if (state.isBytes) {
        // Use byte tokens
        for (let j = state.bytes.length - 1; j >= 0; j--) {
          const byteId = this.byteTokens.get(state.bytes[j]);
          tokens.push(byteId ?? this.unkId);
        }
      } else {
        const substr = text.slice(state.prev, pos);
        const piece = this.pieces.get(substr);
        tokens.push(piece?.id ?? this.unkId);
      }
      pos = state.prev;
    }

    return tokens.reverse();
  }

  /**
   * BPE encoding
   * @private
   */
  _encodeBPE(text) {
    // Start with character-level tokens
    let tokens = [];
    for (const char of text) {
      const piece = this.pieces.get(char);
      if (piece) {
        tokens.push(char);
      } else {
        // Byte fallback
        const bytes = new TextEncoder().encode(char);
        for (const b of bytes) {
          const byteToken = `<0x${b.toString(16).padStart(2, '0').toUpperCase()}>`;
          tokens.push(byteToken);
        }
      }
    }

    // Iteratively merge pairs with highest score
    while (tokens.length > 1) {
      let bestPair = null;
      let bestScore = -Infinity;
      let bestIndex = -1;

      for (let i = 0; i < tokens.length - 1; i++) {
        const merged = tokens[i] + tokens[i + 1];
        const piece = this.pieces.get(merged);
        if (piece && piece.score > bestScore) {
          bestScore = piece.score;
          bestPair = merged;
          bestIndex = i;
        }
      }

      if (bestPair === null) break;

      // Apply merge
      tokens = [
        ...tokens.slice(0, bestIndex),
        bestPair,
        ...tokens.slice(bestIndex + 2)
      ];
    }

    // Convert to IDs
    return tokens.map(t => {
      const piece = this.pieces.get(t);
      return piece?.id ?? this.unkId;
    });
  }

  decode(ids, skipSpecialTokens = true) {
    if (this.pieces.size === 0) {
      throw new Error('SentencePiece model not loaded');
    }

    const tokens = [];
    for (const id of ids) {
      if (skipSpecialTokens && this.isSpecialToken(id)) {
        continue;
      }

      const token = this.reverseVocab.get(id);
      if (token) {
        // Handle byte tokens
        if (token.match(/^<0x[0-9A-Fa-f]{2}>$/)) {
          const byteVal = parseInt(token.slice(3, 5), 16);
          tokens.push(String.fromCharCode(byteVal));
        } else {
          tokens.push(token);
        }
      }
    }

    // Join and convert ▁ back to spaces
    return tokens.join('').replace(/▁/g, ' ').trim();
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

      // Load the model data from the provided source
      let modelData;
      if (tokenizerConfig.sentencepieceModel instanceof ArrayBuffer) {
        modelData = tokenizerConfig.sentencepieceModel;
      } else if (tokenizerConfig.loadShard) {
        // Use provided shard loader
        modelData = await tokenizerConfig.loadShard(tokenizerConfig.sentencepieceModel);
      } else if (typeof tokenizerConfig.sentencepieceModel === 'string') {
        // Try to fetch as URL
        const response = await fetch(tokenizerConfig.sentencepieceModel);
        modelData = await response.arrayBuffer();
      }

      if (modelData) {
        await this.backend.load(modelData);
      } else {
        throw new Error('Could not load SentencePiece model data');
      }
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
