// Standardized UI Manager Module for REPLOID
// Manages the agent's developer console interface

const UI = {
  metadata: {
    id: 'UI',
    version: '1.0.0',
    dependencies: ['config', 'logger', 'Utils', 'Storage', 'StateManager', 'Errors'],
    async: true,  // Has async init
    type: 'ui'
  },
  
  factory: (deps) => {
    // Validate dependencies
    const { config, logger, Utils, Storage, StateManager, Errors } = deps;
    
    if (!config || !logger || !Utils || !Storage || !StateManager || !Errors) {
      throw new Error('UI: Missing required dependencies');
    }
    
    let uiRefs = {};
    let CycleLogic = null;

  const initializeUIElementReferences = () => {
    const ids = [
        "run-cycle-button", "goal-input", "status-indicator",
        "metrics-display", "current-cycle-content", "timeline-log",
        "human-intervention-section", "human-intervention-title",
        "human-intervention-reason", "human-critique-input", "submit-critique-button"
    ];
    ids.forEach(id => {
        uiRefs[Utils.kabobToCamel(id)] = document.getElementById(id);
    });
  };

  const updateStatus = (message) => {
    if (uiRefs.statusIndicator) {
      uiRefs.statusIndicator.textContent = `Status: ${message}`;
    }
  };

  const logToTimeline = (cycle, message, type = "info") => {
    if (!uiRefs.timelineLog) return;
    const li = document.createElement("li");
    li.innerHTML = `<span>[C${cycle}]</span> <span>[${type.toUpperCase()}]</span> ${Utils.escapeHtml(message)}`;
    uiRefs.timelineLog.insertBefore(li, uiRefs.timelineLog.firstChild);
    if (uiRefs.timelineLog.children.length > 100) {
        uiRefs.timelineLog.removeChild(uiRefs.timelineLog.lastChild);
    }
  };

  const updateStateDisplay = async () => {
    if (!uiRefs.metricsDisplay || !StateManager) return;
    // Since getState is now cheap (in-memory read), we don't need to make this async,
    // but the data it displays might be from a slightly older state if a cycle is in progress.
    const state = StateManager.getState();
    if (!state) return;
    uiRefs.metricsDisplay.innerHTML = `Cycle: <strong>${state.totalCycles || 0}</strong>`;
  };

  const displayCycleArtifact = (label, content, type, source, artifactId) => {
      if (!uiRefs.currentCycleContent) return;
      if (uiRefs.currentCycleContent.innerHTML.includes("Waiting for cycle")) {
          uiRefs.currentCycleContent.innerHTML = "";
      }
      const section = document.createElement("div");
      section.className = "artifact-section";
      section.innerHTML = `
        <h4>${Utils.escapeHtml(label)} (${type})</h4>
        <pre><code>${Utils.escapeHtml(String(content))}</code></pre>
      `;
      uiRefs.currentCycleContent.appendChild(section);
  };
  
  const clearCurrentCycleDetails = () => {
      if (uiRefs.currentCycleContent) {
          uiRefs.currentCycleContent.innerHTML = "<p>Waiting for cycle...</p>";
      }
  };

  const setRunButtonState = (text, disabled) => {
      if (uiRefs.runCycleButton) {
          uiRefs.runCycleButton.textContent = text;
          uiRefs.runCycleButton.disabled = disabled;
      }
  };
  
  const showHumanInterventionUI = (mode, reason) => {
      if (uiRefs.humanInterventionSection) {
          uiRefs.humanInterventionSection.classList.remove('hidden');
          if(uiRefs.humanInterventionReason) uiRefs.humanInterventionReason.textContent = reason;
          if(uiRefs.humanCritiqueInput) uiRefs.humanCritiqueInput.focus();
      }
  };

  const setupEventListeners = () => {
      uiRefs.runCycleButton?.addEventListener('click', async () => {
          if (CycleLogic.isRunning()) {
              CycleLogic.abortCurrentCycle();
          } else {
              // The executeCycle is now async, but the click handler doesn't need to await it.
              // It kicks off the process and the UI will update via its own methods.
              CycleLogic.executeCycle();
          }
      });
  };

  const init = async (injectedStateManager, injectedCycleLogic) => {
    logger.logEvent("info", "Agent UIManager taking control of DOM...");
    StateManager = injectedStateManager;
    CycleLogic = injectedCycleLogic;

    // --- JETTISON THE BOOTLOADER ---
    // The agent's first act is to remove the temporary bootloader UI.
    const bootContainer = document.getElementById('boot-container');
    if (bootContainer) {
        bootContainer.remove();
        logger.logEvent("info", "Bootloader UI jettisoned.");
    }
    // Clean up any residual bootloader styles from the body
    document.body.style = "";
    // --- HANDOVER COMPLETE ---

    const bodyTemplate = await Storage.getArtifactContent('/modules/ui-body-template.html');
    const styleContent = await Storage.getArtifactContent('/modules/ui-style.css');
    
    const appRoot = document.getElementById('app-root');
    if (appRoot) {
        if(bodyTemplate) {
            appRoot.innerHTML = bodyTemplate;
        } else {
            // Create minimal fallback UI if template is missing
            logger.logEvent("warn", "UI template not found, creating minimal fallback");
            appRoot.innerHTML = `
                <div style="padding: 20px; font-family: monospace; background: #000; color: #0ff; min-height: 100vh;">
                    <h1 style="color: #ffd700;">REPLOID Agent - Minimal UI</h1>
                    <div id="status-indicator" style="margin: 10px 0;">Status: Initializing...</div>
                    <button id="run-cycle-button" style="background: #111; color: #0ff; border: 1px solid #0ff; padding: 10px; cursor: pointer;">Run Cycle</button>
                    <div id="metrics-display" style="margin: 10px 0;">Cycle: <strong>0</strong></div>
                    <div id="current-cycle-content" style="margin: 20px 0; padding: 10px; border: 1px solid #333;">
                        <p>Waiting for cycle...</p>
                    </div>
                    <div id="timeline-log" style="margin: 20px 0; max-height: 200px; overflow-y: auto; border: 1px solid #333; padding: 10px;"></div>
                    <div id="goal-input" style="display:none;"></div>
                    <div id="human-intervention-section" style="display:none;"></div>
                    <div style="margin-top: 20px; color: #ffd700;">
                        Note: UI files missing. Agent should use write_artifact tool to create:
                        <br>- /modules/ui-body-template.html
                        <br>- /modules/ui-style.css
                    </div>
                </div>
            `;
        }
        appRoot.style.display = 'block'; // Make sure the agent's root is visible.
    }
    
    if (styleContent) {
        const styleEl = document.createElement('style');
        styleEl.id = 'agent-styles'; // Give it an ID for potential self-modification
        styleEl.textContent = styleContent;
        document.head.appendChild(styleEl);
    } else if (!bodyTemplate) {
        // Add minimal styles if both template and styles are missing
        const minimalStyle = document.createElement('style');
        minimalStyle.id = 'agent-styles-minimal';
        minimalStyle.textContent = `
            body { margin: 0; padding: 0; background: #000; color: #0ff; }
            button:hover { background: #222 !important; border-color: #ffd700 !important; }
            #timeline-log li { list-style: none; margin: 2px 0; }
            #current-cycle-content pre { white-space: pre-wrap; word-wrap: break-word; }
        `;
        document.head.appendChild(minimalStyle);
    }
    
    initializeUIElementReferences();
    await updateStateDisplay();
    setupEventListeners();
    logger.logEvent("info", "Agent UI Initialized. Standing by.");
  };

    // Initialize UI self-modification observer
    const initializeSelfModification = () => {
      if (!window.MutationObserver) {
        logger.logEvent('warn', '[UIManager] MutationObserver not available');
        return;
      }
      
      logger.logEvent('info', '[UIManager] Initializing UI self-modification');
      
      // Create mutation observer for UI changes
      const uiObserver = new MutationObserver((mutations) => {
        handleUIMutations(mutations);
      });
      
      // Observe entire document for UI changes
      uiObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'data-reploid']
      });
      
      // Track user interactions for adaptive UI
      document.addEventListener('click', trackUserInteraction);
      document.addEventListener('focus', trackUserInteraction, true);
      
      logger.logEvent('info', '[UIManager] UI self-modification initialized');
    };
    
    // Handle UI mutations for self-modification
    const handleUIMutations = (mutations) => {
      mutations.forEach(mutation => {
        // Track UI patterns
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              enhanceElement(node);
            }
          });
        }
        
        // Track attribute changes for learning
        if (mutation.type === 'attributes') {
          learnFromAttributeChange(mutation);
        }
      });
    };
    
    // Enhance newly added elements
    const enhanceElement = (element) => {
      // Add REPLOID tracking
      if (!element.hasAttribute('data-reploid')) {
        element.setAttribute('data-reploid', 'enhanced');
      }
      
      // Auto-enhance buttons
      if (element.tagName === 'BUTTON') {
        enhanceButton(element);
      }
      
      // Auto-enhance input fields
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        enhanceInput(element);
      }
    };
    
    // Enhance button functionality
    const enhanceButton = (button) => {
      if (button.hasAttribute('data-enhanced')) return;
      button.setAttribute('data-enhanced', 'true');
      
      // Add loading state capability
      const originalClick = button.onclick;
      button.onclick = async function(e) {
        button.classList.add('loading');
        button.disabled = true;
        
        try {
          if (originalClick) {
            await originalClick.call(this, e);
          }
        } finally {
          button.classList.remove('loading');
          button.disabled = false;
        }
      };
    };
    
    // Enhance input fields
    const enhanceInput = (input) => {
      if (input.hasAttribute('data-enhanced')) return;
      input.setAttribute('data-enhanced', 'true');
      
      // Add auto-save capability
      let saveTimeout;
      input.addEventListener('input', () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
          saveInputState(input);
        }, 1000);
      });
    };
    
    // Track user interactions for learning
    const trackUserInteraction = (event) => {
      const element = event.target;
      const interaction = {
        type: event.type,
        element: element.tagName,
        id: element.id,
        classes: element.className,
        timestamp: Date.now()
      };
      
      // Store interaction pattern
      if (!window.reploidUIPatterns) {
        window.reploidUIPatterns = [];
      }
      window.reploidUIPatterns.push(interaction);
      
      // Adapt UI based on patterns
      if (window.reploidUIPatterns.length % 10 === 0) {
        adaptUIBasedOnPatterns();
      }
    };
    
    // Learn from attribute changes
    const learnFromAttributeChange = (mutation) => {
      const element = mutation.target;
      const attribute = mutation.attributeName;
      const newValue = element.getAttribute(attribute);
      
      // Track successful UI states
      if (attribute === 'class' && newValue && newValue.includes('success')) {
        storeSuccessfulUIState(element);
      }
    };
    
    // Adapt UI based on usage patterns
    const adaptUIBasedOnPatterns = () => {
      if (!window.reploidUIPatterns || window.reploidUIPatterns.length < 20) return;
      
      // Analyze patterns
      const elementCounts = {};
      window.reploidUIPatterns.forEach(pattern => {
        const key = `${pattern.element}-${pattern.id || pattern.classes}`;
        elementCounts[key] = (elementCounts[key] || 0) + 1;
      });
      
      // Find most used elements
      const sortedElements = Object.entries(elementCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      
      // Enhance frequently used elements
      sortedElements.forEach(([key, count]) => {
        if (count > 5) {
          const [tag, identifier] = key.split('-');
          enhanceFrequentlyUsedElement(tag, identifier);
        }
      });
    };
    
    // Enhance frequently used elements
    const enhanceFrequentlyUsedElement = (tag, identifier) => {
      let element;
      if (identifier && identifier !== 'undefined') {
        element = document.getElementById(identifier) || 
                 document.querySelector(`${tag}.${identifier.split(' ')[0]}`);
      }
      
      if (element && !element.hasAttribute('data-reploid-enhanced')) {
        element.setAttribute('data-reploid-enhanced', 'true');
        
        // Make it more prominent
        element.style.transition = 'all 0.3s ease';
      }
    };
    
    // Save input state
    const saveInputState = (input) => {
      if (!input.id) return;
      
      const state = {
        id: input.id,
        value: input.value,
        timestamp: Date.now()
      };
      
      // Store in localStorage for persistence
      const key = `reploid-input-${input.id}`;
      localStorage.setItem(key, JSON.stringify(state));
    };
    
    // Store successful UI state
    const storeSuccessfulUIState = (element) => {
      const state = {
        classes: element.className,
        timestamp: Date.now()
      };
      
      // Store for future reference
      const key = `reploid-success-${element.id || element.className}`;
      localStorage.setItem(key, JSON.stringify(state));
    };
    
    // Dynamically create UI elements
    const createAdaptiveElement = (type, config) => {
      const element = document.createElement(type);
      
      // Apply configuration
      if (config.id) element.id = config.id;
      if (config.className) element.className = config.className;
      if (config.text) element.textContent = config.text;
      if (config.html) element.innerHTML = config.html;
      
      // Add REPLOID tracking
      element.setAttribute('data-reploid', 'dynamic');
      element.setAttribute('data-created', Date.now());
      
      // Auto-enhance
      enhanceElement(element);
      
      return element;
    };
    
    // Initialize self-modification after UI setup
    setTimeout(() => {
      if (document.getElementById('app-root')) {
        initializeSelfModification();
      }
    }, 100);
    
    // Public API
    return {
      init,
      api: {
        updateStatus,
        logToTimeline,
        updateStateDisplay,
        displayCycleArtifact,
        clearCurrentCycleDetails,
        setRunButtonState,
        showHumanInterventionUI,
        createAdaptiveElement,
        initializeSelfModification
      }
    };
  }
};

// Legacy compatibility wrapper
const UIModule = (config, logger, Utils, Storage, StateManager, Errors) => {
  const instance = UI.factory({ config, logger, Utils, Storage, StateManager, Errors });
  // Return object with both init and other methods at same level for legacy compatibility
  return {
    init: instance.init,
    ...instance.api
  };
};

// Export both formats
UI;
UIModule;