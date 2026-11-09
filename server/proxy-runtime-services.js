import fs from 'node:fs';
import path from 'node:path';
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import fetch from 'node-fetch';

/** Optional local process and monitoring owners. Imports never start services. */
export function createProxyRuntimeServices({ localEndpoint: LOCAL_MODEL_ENDPOINT, autoStartOllama: AUTO_START_OLLAMA,
  logDirectory, execCommand: execPromise = promisify(exec), spawnProcess = spawn, fetchImpl = fetch }) {
  let closed = false, initialization = null, startupTimer = null, wakeStartup = null;
  const pending = new Set();
  const own = promise => {
    pending.add(promise);
    promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  };
  let ollamaProcess = null;
  let ollamaStatus = 'unknown';

  // GPU monitoring process management
  let gpuMonitorProcess = null;
  const GPU_LOG_DIR = logDirectory;
  const GPU_MONITOR_INTERVAL = 60000; // 60 seconds

  async function checkOllamaRunning() {
    try {
      const response = await fetchImpl(`${LOCAL_MODEL_ENDPOINT}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function updateOllamaStatus() {
    const isRunning = await checkOllamaRunning();
    ollamaStatus = isRunning ? 'running' : 'offline';
  }

  // Check if Ollama is installed
  async function checkOllamaInstalled() {
    try {
      await execPromise('which ollama');
      return true;
    } catch {
      return false;
    }
  }

  // Start Ollama server
  async function startOllama() {
    if (ollamaProcess) {
      console.log('[Ollama] Process already running');
      return;
    }

    const isInstalled = await checkOllamaInstalled();
    if (closed) return;
    if (!isInstalled) {
      console.log('[Ollama] Not installed, skipping auto-start');
      return;
    }

    console.log('[Ollama] Starting Ollama server...');
    ollamaProcess = spawnProcess('ollama', ['serve'], {
      stdio: 'inherit',
      detached: false
    });

    ollamaProcess.on('error', (error) => {
      console.error('[Ollama] Failed to start:', error.message);
      ollamaProcess = null;
    });

    ollamaProcess.on('exit', (code) => {
      console.log(`[Ollama] Process exited with code ${code}`);
      ollamaProcess = null;
      updateOllamaStatus();
    });

    // Give Ollama a few seconds to start
    await new Promise(resolve => { wakeStartup = resolve; startupTimer = setTimeout(resolve, 3000); });
    clearTimeout(startupTimer); startupTimer = null; wakeStartup = null;
    if (closed) return;
    await updateOllamaStatus();

    if (ollamaStatus === 'running') {
      console.log('[Ollama] Successfully started and running');
    }
  }

  // Initialize Ollama (auto-start if configured)
  async function initializeOllama() {
    await updateOllamaStatus();
    if (closed) return;

    if (AUTO_START_OLLAMA && ollamaStatus !== 'running') {
      console.log('[Ollama] Auto-start is enabled, attempting to start Ollama...');
      await startOllama();
    } else if (AUTO_START_OLLAMA) {
      console.log('[Ollama] Auto-start enabled, but Ollama is already running');
    } else {
      console.log('[Ollama] Auto-start disabled, status:', ollamaStatus);
    }
  }

  // GPU monitoring functions
  async function getGPUInfo() {
    const gpuInfo = {
      timestamp: new Date().toISOString(),
      ollama: {
        status: ollamaStatus,
        endpoint: LOCAL_MODEL_ENDPOINT
      }
    };

    // Try to get ROCm GPU info
    try {
      const { stdout: rocmOutput } = await execPromise('rocm-smi --showmeminfo vram --json 2>/dev/null || rocm-smi --json 2>/dev/null || echo "{}"');
      gpuInfo.rocm = JSON.parse(rocmOutput || '{}');
    } catch (rocmError) {
      gpuInfo.rocm = { available: false };
    }

    // Get recent Ollama GPU events from logs
    try {
      const { stdout: ollamaLogs } = await execPromise('journalctl -u ollama --since "5 minutes ago" --no-pager 2>/dev/null | grep -iE "GPU|hang|memory|error" | tail -10 || echo ""');
      gpuInfo.recentEvents = ollamaLogs.split('\n').filter(line => line.trim());
    } catch (logError) {
      gpuInfo.recentEvents = [];
    }

    return gpuInfo;
  }

  async function logGPUStatus() {
    if (closed) return;
    try {
      // Ensure log directory exists
      if (!fs.existsSync(GPU_LOG_DIR)) {
        fs.mkdirSync(GPU_LOG_DIR, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(GPU_LOG_DIR, `gpu-monitor-${timestamp}.log`);

      const gpuInfo = await getGPUInfo();
      if (closed) return;
      const logContent = `=== GPU Status at ${gpuInfo.timestamp} ===\n${JSON.stringify(gpuInfo, null, 2)}\n\n`;

      fs.appendFileSync(logFile, logContent);

      // Clean up old log files (keep last 100)
      const logFiles = fs.readdirSync(GPU_LOG_DIR)
        .filter(f => f.startsWith('gpu-monitor-'))
        .sort()
        .reverse();

      if (logFiles.length > 100) {
        logFiles.slice(100).forEach(f => {
          try {
            fs.unlinkSync(path.join(GPU_LOG_DIR, f));
          } catch (err) {
            // Ignore errors
          }
        });
      }

      console.log(`[GPU Monitor] Logged status to ${path.basename(logFile)}`);
    } catch (error) {
      console.error('[GPU Monitor] Failed to log GPU status:', error.message);
    }
  }

  function startGPUMonitoring() {
    if (gpuMonitorProcess) {
      console.log('[GPU Monitor] Already running');
      return;
    }

    console.log('[GPU Monitor] Starting GPU monitoring...');

    // Log immediately
    void own(logGPUStatus());

    // Then log every 60 seconds
    gpuMonitorProcess = setInterval(() => { void own(logGPUStatus()); }, GPU_MONITOR_INTERVAL);

    console.log(`[GPU Monitor] Monitoring started (interval: ${GPU_MONITOR_INTERVAL / 1000}s)`);
  }

  function stopGPUMonitoring() {
    if (gpuMonitorProcess) {
      clearInterval(gpuMonitorProcess);
      gpuMonitorProcess = null;
      console.log('[GPU Monitor] Stopped');
    }
  }
  let statusTimer = null;
  return {
    get ollamaStatus() { return ollamaStatus; },
    get monitoring() { return { enabled: !!gpuMonitorProcess, interval: GPU_MONITOR_INTERVAL / 1000, logDirectory: GPU_LOG_DIR }; },
    getGPUInfo,
    start() {
      if (closed) throw Error('Runtime services are closed');
      if (initialization) return initialization;
      initialization = own(initializeOllama());
      statusTimer = setInterval(() => { void own(updateOllamaStatus()); }, 10000);
      startGPUMonitoring();
      return initialization;
    },
    async close() {
      closed = true;
      clearTimeout(startupTimer); wakeStartup?.();
      clearInterval(statusTimer); statusTimer = null;
      stopGPUMonitoring();
      if (ollamaProcess) {
        console.log('[Ollama] Stopping managed Ollama process...');
        ollamaProcess.kill(); ollamaProcess = null;
      }
      await Promise.all([...pending]);
    }
  };
}
