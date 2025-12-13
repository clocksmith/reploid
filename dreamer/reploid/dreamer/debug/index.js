/**
 * DOPPLER Debug Module - Unified Logging, Debugging, and Testing
 *
 * Centralizes all debug/logging functionality across the DOPPLER project.
 * Provides consistent log levels, module tags, tensor inspection, and
 * integration with GPU profiler.
 *
 * Usage:
 *   import { log, debug, tensor, setLogLevel } from '../debug/index.js';
 *
 *   log.info('Pipeline', 'Model loaded');
 *   log.debug('Attention', `heads=${numHeads}, dim=${headDim}`);
 *   debug.tensor(buffer, 'qkv_output', { shape: [numTokens, hiddenSize] });
 *   setLogLevel('debug'); // Enable all debug logs
 *
 * @module debug
 */

// Log levels (lower = more verbose)
export const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4,
};

// Global state
let currentLogLevel = LOG_LEVELS.INFO;
let enabledModules = new Set(); // Empty = all enabled
let disabledModules = new Set();
let logHistory = [];
const MAX_HISTORY = 1000;

// GPU device reference for tensor inspection
let gpuDevice = null;

/**
 * Set the global log level.
 * @param {'debug' | 'info' | 'warn' | 'error' | 'silent'} level
 */
export function setLogLevel(level) {
  const levelMap = {
    debug: LOG_LEVELS.DEBUG,
    info: LOG_LEVELS.INFO,
    warn: LOG_LEVELS.WARN,
    error: LOG_LEVELS.ERROR,
    silent: LOG_LEVELS.SILENT,
  };
  currentLogLevel = levelMap[level.toLowerCase()] ?? LOG_LEVELS.INFO;
  console.log(`[DOPPLER] Log level set to: ${level.toUpperCase()}`);
}

/**
 * Enable logging for specific modules only.
 * @param {...string} modules - Module names to enable
 */
export function enableModules(...modules) {
  enabledModules = new Set(modules.map(m => m.toLowerCase()));
  console.log(`[DOPPLER] Enabled modules: ${modules.join(', ')}`);
}

/**
 * Disable logging for specific modules.
 * @param {...string} modules - Module names to disable
 */
export function disableModules(...modules) {
  for (const m of modules) {
    disabledModules.add(m.toLowerCase());
  }
  console.log(`[DOPPLER] Disabled modules: ${modules.join(', ')}`);
}

/**
 * Reset module filters.
 */
export function resetModuleFilters() {
  enabledModules.clear();
  disabledModules.clear();
}

/**
 * Check if logging is enabled for a module at a level.
 * @private
 */
function shouldLog(module, level) {
  if (level < currentLogLevel) return false;

  const moduleLower = module.toLowerCase();

  // If specific modules are enabled, only log those
  if (enabledModules.size > 0 && !enabledModules.has(moduleLower)) {
    return false;
  }

  // Check disabled list
  if (disabledModules.has(moduleLower)) {
    return false;
  }

  return true;
}

/**
 * Format a log message with timestamp and module tag.
 * @private
 */
function formatMessage(module, message) {
  const timestamp = performance.now().toFixed(1);
  return `[${timestamp}ms][${module}] ${message}`;
}

/**
 * Store log in history for later retrieval.
 * @private
 */
function storeLog(level, module, message, data) {
  logHistory.push({
    time: Date.now(),
    perfTime: performance.now(),
    level,
    module,
    message,
    data,
  });

  if (logHistory.length > MAX_HISTORY) {
    logHistory.shift();
  }
}

/**
 * Main logging interface.
 */
export const log = {
  /**
   * Debug level logging (verbose).
   * @param {string} module - Module name (e.g., 'Pipeline', 'Attention')
   * @param {string} message - Log message
   * @param {*} [data] - Optional data to log
   */
  debug(module, message, data) {
    if (!shouldLog(module, LOG_LEVELS.DEBUG)) return;
    const formatted = formatMessage(module, message);
    storeLog('DEBUG', module, message, data);
    if (data !== undefined) {
      console.debug(formatted, data);
    } else {
      console.debug(formatted);
    }
  },

  /**
   * Info level logging (normal operations).
   */
  info(module, message, data) {
    if (!shouldLog(module, LOG_LEVELS.INFO)) return;
    const formatted = formatMessage(module, message);
    storeLog('INFO', module, message, data);
    if (data !== undefined) {
      console.log(formatted, data);
    } else {
      console.log(formatted);
    }
  },

  /**
   * Warning level logging.
   */
  warn(module, message, data) {
    if (!shouldLog(module, LOG_LEVELS.WARN)) return;
    const formatted = formatMessage(module, message);
    storeLog('WARN', module, message, data);
    if (data !== undefined) {
      console.warn(formatted, data);
    } else {
      console.warn(formatted);
    }
  },

  /**
   * Error level logging.
   */
  error(module, message, data) {
    if (!shouldLog(module, LOG_LEVELS.ERROR)) return;
    const formatted = formatMessage(module, message);
    storeLog('ERROR', module, message, data);
    if (data !== undefined) {
      console.error(formatted, data);
    } else {
      console.error(formatted);
    }
  },

  /**
   * Always log regardless of level (for critical messages).
   */
  always(module, message, data) {
    const formatted = formatMessage(module, message);
    storeLog('ALWAYS', module, message, data);
    if (data !== undefined) {
      console.log(formatted, data);
    } else {
      console.log(formatted);
    }
  },
};

/**
 * Set GPU device for tensor inspection.
 * @param {GPUDevice} device
 */
export function setGPUDevice(device) {
  gpuDevice = device;
}

/**
 * Tensor inspection utilities.
 */
export const tensor = {
  /**
   * Inspect a GPU or CPU tensor and log statistics.
   * @param {GPUBuffer|Float32Array|Float16Array} buffer - Tensor data
   * @param {string} label - Tensor name/label
   * @param {Object} [options]
   * @param {number[]} [options.shape] - Tensor shape for interpretation
   * @param {number} [options.maxPrint=8] - Max values to print
   * @param {boolean} [options.checkNaN=true] - Check for NaN/Inf
   * @returns {Promise<Object>} Tensor stats
   */
  async inspect(buffer, label, options = {}) {
    const { shape = [], maxPrint = 8, checkNaN = true } = options;

    let data;
    let isGPU = false;

    // Handle GPU buffers
    if (buffer && typeof buffer.mapAsync === 'function') {
      // It's already mappable
      await buffer.mapAsync(GPUMapMode.READ);
      data = new Float32Array(buffer.getMappedRange().slice(0));
      buffer.unmap();
    } else if (buffer && buffer.size !== undefined && gpuDevice) {
      // It's a GPUBuffer, need to create staging buffer
      isGPU = true;
      const readSize = Math.min(buffer.size, 4096); // Read up to 4KB
      const staging = gpuDevice.createBuffer({
        label: `debug_staging_${label}`,
        size: readSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      const encoder = gpuDevice.createCommandEncoder();
      encoder.copyBufferToBuffer(buffer, 0, staging, 0, readSize);
      gpuDevice.queue.submit([encoder.finish()]);

      await staging.mapAsync(GPUMapMode.READ);
      data = new Float32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      staging.destroy();
    } else if (buffer instanceof Float32Array || buffer instanceof Float64Array) {
      data = buffer;
    } else if (buffer instanceof Uint16Array) {
      // Likely F16, convert to F32 for stats
      data = new Float32Array(buffer.length);
      for (let i = 0; i < buffer.length; i++) {
        data[i] = f16ToF32(buffer[i]);
      }
    } else {
      log.warn('Debug', `Cannot inspect tensor "${label}": unknown type`);
      return null;
    }

    // Compute statistics
    let min = Infinity, max = -Infinity, sum = 0, sumSq = 0;
    let nanCount = 0, infCount = 0, zeroCount = 0;

    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (Number.isNaN(v)) {
        nanCount++;
        continue;
      }
      if (!Number.isFinite(v)) {
        infCount++;
        continue;
      }
      if (v === 0) zeroCount++;
      min = Math.min(min, v);
      max = Math.max(max, v);
      sum += v;
      sumSq += v * v;
    }

    const validCount = data.length - nanCount - infCount;
    const mean = validCount > 0 ? sum / validCount : 0;
    const variance = validCount > 0 ? (sumSq / validCount) - (mean * mean) : 0;
    const std = Math.sqrt(Math.max(0, variance));

    const stats = {
      label,
      shape,
      size: data.length,
      isGPU,
      min,
      max,
      mean,
      std,
      nanCount,
      infCount,
      zeroCount,
      zeroPercent: ((zeroCount / data.length) * 100).toFixed(1),
      first: Array.from(data.slice(0, maxPrint)).map(v => v.toFixed(4)),
      last: Array.from(data.slice(-maxPrint)).map(v => v.toFixed(4)),
    };

    // Log the stats
    const shapeStr = shape.length > 0 ? `[${shape.join('x')}]` : `[${data.length}]`;
    log.debug('Tensor', `${label} ${shapeStr}: min=${min.toFixed(4)}, max=${max.toFixed(4)}, mean=${mean.toFixed(4)}, std=${std.toFixed(4)}`);

    if (checkNaN && (nanCount > 0 || infCount > 0)) {
      log.warn('Tensor', `${label} has ${nanCount} NaN and ${infCount} Inf values!`);
    }

    return stats;
  },

  /**
   * Compare two tensors element-wise.
   * @param {Float32Array} a - First tensor
   * @param {Float32Array} b - Second tensor
   * @param {string} label - Comparison label
   * @param {number} [tolerance=1e-5] - Absolute tolerance
   * @returns {Object} Comparison results
   */
  compare(a, b, label, tolerance = 1e-5) {
    if (a.length !== b.length) {
      log.error('Tensor', `${label}: size mismatch ${a.length} vs ${b.length}`);
      return { match: false, error: 'size_mismatch' };
    }

    let maxDiff = 0, maxDiffIdx = 0;
    let sumDiff = 0;
    let mismatchCount = 0;

    for (let i = 0; i < a.length; i++) {
      const diff = Math.abs(a[i] - b[i]);
      sumDiff += diff;
      if (diff > maxDiff) {
        maxDiff = diff;
        maxDiffIdx = i;
      }
      if (diff > tolerance) {
        mismatchCount++;
      }
    }

    const avgDiff = sumDiff / a.length;
    const match = mismatchCount === 0;

    const result = {
      label,
      match,
      maxDiff,
      maxDiffIdx,
      avgDiff,
      mismatchCount,
      mismatchPercent: ((mismatchCount / a.length) * 100).toFixed(2),
    };

    if (match) {
      log.debug('Tensor', `${label}: MATCH (maxDiff=${maxDiff.toExponential(2)})`);
    } else {
      log.warn('Tensor', `${label}: MISMATCH ${mismatchCount}/${a.length} (${result.mismatchPercent}%) maxDiff=${maxDiff.toFixed(6)} at idx=${maxDiffIdx}`);
    }

    return result;
  },

  /**
   * Check tensor for common issues.
   * @param {Float32Array} data - Tensor data
   * @param {string} label - Tensor name
   * @returns {Object} Health check results
   */
  healthCheck(data, label) {
    const issues = [];

    // Check for all zeros
    const allZero = data.every(v => v === 0);
    if (allZero) {
      issues.push('ALL_ZEROS');
    }

    // Check for NaN/Inf
    const hasNaN = data.some(v => Number.isNaN(v));
    const hasInf = data.some(v => !Number.isFinite(v) && !Number.isNaN(v));
    if (hasNaN) issues.push('HAS_NAN');
    if (hasInf) issues.push('HAS_INF');

    // Check for extreme values
    const maxAbs = Math.max(...data.map(Math.abs).filter(Number.isFinite));
    if (maxAbs > 1e6) issues.push(`EXTREME_VALUES (max=${maxAbs.toExponential(2)})`);

    // Check for tiny non-zero values (potential underflow)
    const tinyCount = data.filter(v => Math.abs(v) > 0 && Math.abs(v) < 1e-30).length;
    if (tinyCount > data.length * 0.1) {
      issues.push(`POTENTIAL_UNDERFLOW (${tinyCount} tiny values)`);
    }

    const healthy = issues.length === 0;

    if (healthy) {
      log.debug('Tensor', `${label}: healthy`);
    } else {
      log.warn('Tensor', `${label}: issues found - ${issues.join(', ')}`);
    }

    return { label, healthy, issues };
  },
};

/**
 * Performance timing utilities.
 */
export const perf = {
  marks: new Map(),

  /**
   * Start a timing mark.
   * @param {string} label
   */
  mark(label) {
    this.marks.set(label, performance.now());
  },

  /**
   * End a timing mark and log duration.
   * @param {string} label
   * @param {string} [module='Perf']
   * @returns {number} Duration in ms
   */
  measure(label, module = 'Perf') {
    const start = this.marks.get(label);
    if (start === undefined) {
      log.warn(module, `No mark found for "${label}"`);
      return 0;
    }

    const duration = performance.now() - start;
    this.marks.delete(label);
    log.debug(module, `${label}: ${duration.toFixed(2)}ms`);
    return duration;
  },

  /**
   * Time an async operation.
   * @param {string} label
   * @param {Function} fn
   * @returns {Promise<{result: *, durationMs: number}>}
   */
  async time(label, fn) {
    const start = performance.now();
    const result = await fn();
    const durationMs = performance.now() - start;
    log.debug('Perf', `${label}: ${durationMs.toFixed(2)}ms`);
    return { result, durationMs };
  },
};

/**
 * Get log history for debugging.
 * @param {Object} [filter]
 * @param {string} [filter.level] - Filter by level
 * @param {string} [filter.module] - Filter by module
 * @param {number} [filter.last] - Get last N entries
 * @returns {Array}
 */
export function getLogHistory(filter = {}) {
  let history = [...logHistory];

  if (filter.level) {
    history = history.filter(h => h.level === filter.level.toUpperCase());
  }

  if (filter.module) {
    const m = filter.module.toLowerCase();
    history = history.filter(h => h.module.toLowerCase().includes(m));
  }

  if (filter.last) {
    history = history.slice(-filter.last);
  }

  return history;
}

/**
 * Clear log history.
 */
export function clearLogHistory() {
  logHistory = [];
}

/**
 * Print a summary of recent logs.
 * @param {number} [count=20]
 */
export function printLogSummary(count = 20) {
  const recent = logHistory.slice(-count);
  console.log('=== Recent Logs ===');
  for (const entry of recent) {
    const time = entry.perfTime.toFixed(1);
    console.log(`[${time}ms][${entry.level}][${entry.module}] ${entry.message}`);
  }
  console.log('===================');
}

/**
 * F16 to F32 conversion helper.
 * @private
 */
function f16ToF32(h) {
  const sign = (h >> 15) & 0x1;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;

  if (exp === 0) {
    // Subnormal or zero
    return (sign ? -1 : 1) * Math.pow(2, -14) * (mant / 1024);
  } else if (exp === 31) {
    // Inf or NaN
    return mant === 0 ? (sign ? -Infinity : Infinity) : NaN;
  }

  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + mant / 1024);
}

/**
 * Export a debug snapshot for bug reports.
 * @returns {Object}
 */
export function getDebugSnapshot() {
  return {
    timestamp: new Date().toISOString(),
    logLevel: Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === currentLogLevel),
    enabledModules: [...enabledModules],
    disabledModules: [...disabledModules],
    recentLogs: logHistory.slice(-50).map(e => ({
      time: e.perfTime.toFixed(1),
      level: e.level,
      module: e.module,
      message: e.message,
    })),
    errorCount: logHistory.filter(e => e.level === 'ERROR').length,
    warnCount: logHistory.filter(e => e.level === 'WARN').length,
  };
}

// Default export
export default {
  log,
  tensor,
  perf,
  setLogLevel,
  setGPUDevice,
  enableModules,
  disableModules,
  resetModuleFilters,
  getLogHistory,
  clearLogHistory,
  printLogSummary,
  getDebugSnapshot,
  LOG_LEVELS,
};
