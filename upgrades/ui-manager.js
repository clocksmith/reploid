// Standardized UI Manager Module for REPLOID - v2.0 (Dashboard Enabled)

const UI = {
  metadata: {
    id: 'UI',
    version: '2.1.0',
    dependencies: ['config', 'Utils', 'DiffGenerator', 'EventBus'],
    async: true,
    type: 'ui'
  },
  
  factory: (deps) => {
    const { config, Utils, DiffGenerator, EventBus } = deps;
    const { logger } = Utils;

    let uiRefs = {};
    let isLogView = false;
    let bootConfig = null;

    const renderVfsExplorer = async () => {
        if (!uiRefs.vfsTree) return;

        const allMeta = await StateManager.getAllArtifactMetadata();
        const fileTree = {};

        for (const path in allMeta) {
            let currentLevel = fileTree;
            const parts = path.split('/').filter(p => p);
            parts.forEach((part, index) => {
                if (index === parts.length - 1) {
                    currentLevel[part] = { _isLeaf: true, path };
                } else {
                    if (!currentLevel[part]) {
                        currentLevel[part] = {};
                    }
                    currentLevel = currentLevel[part];
                }
            });
        }

        const createTreeHtml = (tree) => {
            let html = '<ul>';
            for (const key in tree) {
                if (tree[key]._isLeaf) {
                    html += `<li><a href="#" data-path="${tree[key].path}">${key}</a></li>`;
                } else {
                    html += `<li>${key}${createTreeHtml(tree[key])}</li>`;
                }
            }
            html += '</ul>';
            return html;
        };

        uiRefs.vfsTree.innerHTML = createTreeHtml(fileTree);

        // Add click listeners
        uiRefs.vfsTree.querySelectorAll('a').forEach(a => {
            a.addEventListener('click', async (e) => {
                e.preventDefault();
                const path = e.target.dataset.path;
                const content = await StateManager.getArtifactContent(path);
                // For now, log to advanced log. A proper file viewer would be next.
                logToAdvanced(`Content of ${path}:\n${content}`, 'vfs-file');
            });
        });
    };

    const init = async () => {
        logger.info("Dashboard UI Manager (Event-Driven) taking control of DOM...");
        bootConfig = window.REPLOID_BOOT_CONFIG || {};

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
        setupEventBusListeners(); // New setup for event listeners
        checkPersonaMode();
        await renderVfsExplorer(); // Render the VFS tree
        logger.info("Dashboard UI Initialized. Listening for events.");
    };

    const initializeUIElementReferences = () => {
        const ids = [
            "goal-text", "thought-stream", "diff-viewer", "log-toggle-btn", 
            "advanced-log-panel", "log-output", "thought-panel", 
            "visual-preview-panel", "preview-iframe", "dashboard", "status-bar"
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
        
        if (bootConfig?.persona?.id === 'rfc_author') {
            addRFCButton();
        }
    };

    const setupEventBusListeners = () => {
        EventBus.on('agent:state:change', handleStateChange);
        // ... other listeners
    };

    const handleStateChange = async ({ newState, context }) => {
        const sentinelContent = uiRefs.sentinelContent;
        const approveBtn = uiRefs.sentinelApproveBtn;
        const reviseBtn = uiRefs.sentinelReviseBtn;

        // Hide all actions by default
        approveBtn.classList.add('hidden');
        reviseBtn.classList.add('hidden');
        sentinelContent.innerHTML = '';

        switch (newState) {
            case 'AWAITING_CONTEXT_APPROVAL':
                sentinelContent.innerHTML = `<h4>Review Context (cats.md)</h4><p>Agent wants to read the following files:</p>`;
                const catsContent = await StateManager.getArtifactContent(context.turn.cats_path);
                sentinelContent.innerHTML += `<pre>${catsContent}</pre>`;
                approveBtn.classList.remove('hidden');
                approveBtn.onclick = () => EventBus.emit('user:approve:context');
                break;

            case 'AWAITING_PROPOSAL_APPROVAL':
                sentinelContent.innerHTML = `<h4>Review Proposal (dogs.md)</h4><p>Agent proposes the following changes:</p>`;

                // Use the interactive diff viewer if available
                const diffViewerPanel = document.getElementById('diff-viewer-panel');
                if (diffViewerPanel) {
                    diffViewerPanel.classList.remove('hidden');
                    // Trigger the diff viewer to show the dogs bundle
                    EventBus.emit('diff:show', {
                        dogs_path: context.turn.dogs_path,
                        session_id: context.sessionId,
                        turn: context.turn
                    });
                } else {
                    // Fallback to simple display
                    const dogsContent = await StateManager.getArtifactContent(context.turn.dogs_path);
                    sentinelContent.innerHTML += `<pre>${dogsContent}</pre>`;
                    approveBtn.classList.remove('hidden');
                    approveBtn.onclick = () => EventBus.emit('user:approve:proposal');
                }
                break;

            case 'IDLE':
                sentinelContent.innerHTML = '<p>Agent is idle. Set a goal to begin.</p>';
                break;

            default:
                sentinelContent.innerHTML = `<p>Agent is in state: <strong>${newState}</strong></p>`;
                break;
        }
    };

    
    const checkPersonaMode = () => {
        if (bootConfig?.persona?.type === 'factory') {
            uiRefs.dashboard?.classList.add('factory-mode');
            uiRefs.visualPreviewPanel?.classList.remove('hidden');
            logger.info("Factory mode enabled with live preview.");
        }
    };
    
    const addRFCButton = () => {
        const rfcButton = document.createElement('button');
        rfcButton.id = 'generate-rfc-btn';
        rfcButton.textContent = 'Generate RFC';
        rfcButton.style.cssText = 'padding: 10px; margin: 10px; background: #333; color: #0ff; border: 1px solid #0ff; cursor: pointer;';
        
        rfcButton.addEventListener('click', () => {
            const title = prompt('Enter a title for the RFC:');
            if (title) {
                const rfcGoal = `Draft an RFC titled '${title}'. First, use the create_rfc tool. Then, analyze the project and fill out the document.`;
                EventBus.emit('goal:set', rfcGoal);
                logToAdvanced(`RFC generation initiated: ${title}`);
            }
        });
        
        const goalPanel = document.getElementById('goal-panel');
        if (goalPanel) {
            goalPanel.appendChild(rfcButton);
        }
    };

    const updateGoal = (text) => {
        if (uiRefs.goalText) uiRefs.goalText.textContent = text;
        logToAdvanced(`Goal Updated: ${text}`, 'goal_modified');
    };

    const streamThought = (textChunk) => {
        if (isLogView) return;
        if (uiRefs.thoughtStream) {
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

    const logToAdvanced = (data, type = 'info') => {
        if (uiRefs.logOutput) {
            let message = data;
            let details = {};
            let level = type;

            if (typeof data === 'object') {
                message = data.message;
                details = data.details || {};
                level = data.level || type;
            }

            const line = document.createElement('div');
            line.textContent = `[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${message}`;
            
            switch(level.toLowerCase()) {
                case 'info': line.style.color = '#fff'; break;
                case 'warn': line.style.color = '#ff0'; break;
                case 'error': line.style.color = '#f00'; break;
                case 'cycle': line.style.color = '#0ff'; break;
                default: line.style.color = '#aaa'; break;
            }

            // Optional: Add details view
            if (Object.keys(details).length > 0) {
                const detailsPre = document.createElement('pre');
                detailsPre.style.cssText = 'margin-left: 20px; font-size: 0.8em; color: #ccc;';
                detailsPre.textContent = JSON.stringify(details, null, 2);
                line.appendChild(detailsPre);
            }

            uiRefs.logOutput.appendChild(line);
            uiRefs.logOutput.scrollTop = uiRefs.logOutput.scrollHeight;
        }
    };

    return {
      init,
      api: {}
    };
  }
};

// Export standardized module
UI;