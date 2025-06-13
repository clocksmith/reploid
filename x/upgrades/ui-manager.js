const UIModule = (config, logger, Utils, Storage, StateManager, Errors) => {
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

  const updateStateDisplay = () => {
    if (!uiRefs.metricsDisplay || !StateManager) return;
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
      uiRefs.runCycleButton?.addEventListener('click', () => {
          if (CycleLogic.isRunning()) {
              CycleLogic.abortCurrentCycle();
          } else {
              CycleLogic.executeCycle();
          }
      });
      
      // Add other listeners as needed for HITL etc.
  };

  const init = (injectedStateManager, injectedCycleLogic) => {
    logger.logEvent("info", "Initializing Primordial UI Module...");
    StateManager = injectedStateManager;
    CycleLogic = injectedCycleLogic;

    const bodyTemplate = Storage.getArtifactContent('/modules/ui-body-template.html');
    const styleContent = Storage.getArtifactContent('/modules/ui-style.css');
    
    const appRoot = document.getElementById('app-root');
    if (appRoot && bodyTemplate) {
        appRoot.innerHTML = bodyTemplate;
    }
    
    if (styleContent) {
        const styleEl = document.createElement('style');
        styleEl.textContent = styleContent;
        document.head.appendChild(styleEl);
    }
    
    initializeUIElementReferences();
    updateStateDisplay();
    setupEventListeners();
    logger.logEvent("info", "Primordial UI Module Initialized.");
  };

  return {
    init,
    updateStatus,
    logToTimeline,
    updateStateDisplay,
    displayCycleArtifact,
    clearCurrentCycleDetails,
    setRunButtonState,
    showHumanInterventionUI,
    // Add other exports as needed
  };
};