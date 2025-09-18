// Standardized UI Manager Module for REPLOID - v2.0 (Dashboard Enabled)

const UI = {
  metadata: {
    id: 'UI',
    version: '2.0.0',
    dependencies: ['config', 'Utils', 'Storage', 'StateManager', 'DiffGenerator'],
    async: true,
    type: 'ui'
  },
  
  factory: (deps) => {
    const { config, Utils, Storage, StateManager, DiffGenerator } = deps;
    const { logger } = Utils;

    let uiRefs = {};
    let CycleLogic = null;
    let isLogView = false;

    const init = async (injectedStateManager, injectedCycleLogic) => {
        logger.logEvent("info", "Dashboard UI Manager taking control of DOM...");
        StateManager = injectedStateManager;
        CycleLogic = injectedCycleLogic;

        const bootContainer = document.getElementById('boot-container');
        if (bootContainer) bootContainer.remove();
        
        document.body.style = "";

        const [bodyTemplate, styleContent] = await Promise.all([
            fetch('ui-dashboard.html').then(res => res.text()),
            fetch('styles/dashboard.css').then(res => res.text())
        ]);

        const appRoot = document.getElementById('app-root');
        appRoot.innerHTML = bodyTemplate;
        appRoot.style.display = 'block';

        const styleEl = document.createElement('style');
        styleEl.textContent = styleContent;
        document.head.appendChild(styleEl);

        initializeUIElementReferences();
        setupEventListeners();
        logger.logEvent("info", "Dashboard UI Initialized. Standing by.");
    };

    const initializeUIElementReferences = () => {
        const ids = [
            "goal-text", "thought-stream", "diff-viewer", "log-toggle-btn", 
            "advanced-log-panel", "log-output", "thought-panel"
        ];
        ids.forEach(id => {
            uiRefs[Utils.kabobToCamel(id)] = document.getElementById(id);
        });
    };

    const setupEventListeners = () => {
        uiRefs.logToggleBtn?.addEventListener('click', () => {
            isLogView = !isLogView;
            uiRefs.thoughtPanel.classList.toggle('hidden', isLogView);
            uiRefs.advancedLogPanel.classList.toggle('hidden', !isLogView);
            uiRefs.logToggleBtn.textContent = isLogView ? 'Show Agent Thoughts' : 'Show Advanced Logs';
        });
    };

    const updateGoal = (text) => {
        if (uiRefs.goalText) uiRefs.goalText.textContent = text;
        logToAdvanced(`Goal Updated: ${text}`);
    };

    const streamThought = (textChunk) => {
        if (isLogView) return;
        if (uiRefs.thoughtStream) {
            // Simple append for now, could be more sophisticated
            uiRefs.thoughtStream.textContent += textChunk;
        }
    };
    
    const clearThoughts = () => {
        if(uiRefs.thoughtStream) uiRefs.thoughtStream.textContent = '';
    };

    const renderFileDiff = (path, oldContent, newContent) => {
        if (isLogView) return;
        if (!uiRefs.diffViewer || !DiffGenerator) return;
        
        const diff = DiffGenerator.createDiff(oldContent, newContent);
        const diffHtml = diff.map(part => {
            const line = Utils.escapeHtml(part.line);
            if (part.type === 'add') return `<span class="diff-add">+ ${line}</span>`;
            if (part.type === 'remove') return `<span class="diff-remove">- ${line}</span>`;
            return `  ${line}`;
        }).join('\n');

        uiRefs.diffViewer.innerHTML += `<h4>Changes for ${path}</h4><pre>${diffHtml}</pre>`;
    };
    
    const clearFileDiffs = () => {
        if(uiRefs.diffViewer) uiRefs.diffViewer.innerHTML = '';
    };

    const logToAdvanced = (message) => {
        if (uiRefs.logOutput) {
            const line = document.createElement('div');
            line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
            uiRefs.logOutput.appendChild(line);
            uiRefs.logOutput.scrollTop = uiRefs.logOutput.scrollHeight;
        }
    };

    return {
      init,
      api: {
        updateGoal,
        streamThought,
        clearThoughts,
        renderFileDiff,
        clearFileDiffs,
        logToAdvanced
      }
    };
  }
};

// For legacy boot process
const UIModule = (config, logger, Utils, Storage, StateManager, Errors) => {
    // DiffGenerator would need to be loaded/available globally for this to work
    const DiffGenerator = window.DiffGenerator; 
    const instance = UI.factory({ config, logger, Utils, Storage, StateManager, Errors, DiffGenerator });
    return {
      init: instance.init,
      ...instance.api
    };
};