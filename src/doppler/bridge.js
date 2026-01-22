/**
 * @fileoverview Doppler Bridge Adapter
 * Exposes core Doppler functionality to the Reploid host.
 * This acts as the boundary between the Reploid application and the Doppler library.
 */

import { Pipeline } from '../../doppler/src/inference/pipeline.js';
import { getRuntimeConfig, setRuntimeConfig } from '../../doppler/src/config/runtime.js';
import { downloadModel, getDownloadProgress, pauseDownload, resumeDownload, listDownloads, deleteDownloadState } from '../../doppler/src/loader/doppler-loader.js';
import { checkSpaceAvailable } from '../../doppler/src/storage/quota.js';
import { getDevice } from '../../doppler/src/gpu/device.js';

// Re-export specific types or constants if needed
// export * from '../../doppler/src/config/types.js';

export const DopplerBridge = {
    /**
     * Initialize the Doppler bridge.
     * Can be used to perform any global setup or validation.
     */
    init() {
        console.log('[DopplerBridge] Initialized');
    },

    /**
     * Create a new inference pipeline.
     * @param {Object} manifest - RDRR model manifest.
     * @param {Object} contexts - Execution contexts (gpu, memory, storage).
     * @returns {Promise<Pipeline>}
     */
    async createPipeline(manifest, contexts = {}) {
        return Pipeline.create(manifest, contexts);
    },

    /**
     * Access Runtime Configuration.
     */
    config: {
        get: getRuntimeConfig,
        set: setRuntimeConfig,
    },

    /**
     * Model Management (Loader/Storage).
     */
    storage: {
        downloadModel,
        getDownloadProgress,
        pauseDownload,
        resumeDownload,
        listDownloads,
        deleteDownloadState,
        checkSpaceAvailable,
    },

    /**
     * Diagnostics and Utilities.
     */
    diagnostics: {
        getDevice,
        // Add accessors for benchmarks or debug tools here
    }
};
