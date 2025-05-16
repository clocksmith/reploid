const AgentLogicPureHelpersModule = (() => {

  const getArtifactListSummaryPure = (allMetaMap) => {
    if (!allMetaMap) return "Error: Artifact metadata map not available.";
    return (Object.values(allMetaMap)
        .filter((meta) => meta && meta.latestCycle >= 0)
        .map((meta) => `* ${meta.id} (${meta.type || "UNTYPED"} ${meta.paradigm ? '('+meta.paradigm+')' : ''}) - Cycle ${meta.latestCycle}${meta.version_id ? ` V:${meta.version_id}` : ""}`)
        .join("\n") || "None");
  };

  const getRegisteredWebComponentsListPure = (wcList) => {
    if (!wcList) return "Error: Web component list not available.";
    return wcList.length > 0 ? wcList.map((tag) => `* <${tag}>`).join("\n") : "None";
  };

  const getToolListSummaryPure = (staticTools, dynamicTools, truncFn) => {
    if (!staticTools || !dynamicTools || !truncFn) return "Error: Tool lists or truncFn not available.";
    const staticToolSummary = staticTools.map((t) => `* [S] ${t.name}: ${truncFn(t.description, 60)}`).join("\n");
    const dynamicToolSummary = dynamicTools.map((t) => `* [D] ${t.declaration.name}: ${truncFn(t.declaration.description, 60)}`).join("\n");
    return ([staticToolSummary, dynamicToolSummary].filter((s) => s).join("\n") || "None");
  };

  const summarizeHistoryPure = (historyArray, label, maxItems = 5, truncFn) => {
    if (!historyArray || historyArray.length === 0) return `No ${label} available.`;
    if (!truncFn) return `Error: truncFn not available for history summary.`;
    const recentItems = historyArray.slice(-maxItems);
    return recentItems.map((item, index) => {
        const itemIndex = historyArray.length - recentItems.length + index + 1;
        let summary = `${label} ${itemIndex}: `;
        if (label.includes("Eval")) {
          summary += `Score=${item.evaluation_score?.toFixed(2)}, Target=${item.targetArtifactId || "N/A"}(C${item.targetArtifactCycle ?? "N/A"}), Report=${truncFn(item.evaluation_report, 50)}`;
        } else if (label.includes("Critique History")) {
          summary += item ? "Fail" : "Pass";
        } else if (label.includes("Critique Feedback")) {
          summary += `Selected: ${item.feedback?.selectedCritique ?? "N/A"}, Notes: ${truncFn(item.feedback?.feedbackNotes, 60)}`;
        } else if (label.includes("Fail History")) {
          summary += `Cycle ${item.cycle}, Reason: ${truncFn(item.reason, 60)}`;
        } else {
          summary += truncFn(JSON.stringify(item), 80);
        }
        return summary;
      }).join(" | ");
  };

  const assembleCorePromptPure = (
    corePromptTemplate, state, goalInfo,
    artifactListSummary, registeredWebComponentsList, toolListSummary,
    recentLogs, artifactSnippets, truncFn
  ) => {
    if (!corePromptTemplate) return { error: "Core prompt template missing." };

    const personaBalance = state.cfg?.personaBalance ?? 50;
    const primaryPersona = state.personaMode;
    const critiqueHistorySummary = summarizeHistoryPure(state.critiqueFailHistory || [], "Critique History", 5, truncFn);
    const critiqueFeedbackSummary = summarizeHistoryPure(state.critiqueFeedbackHistory || [], "Critique Feedback", 5, truncFn);
    const evaluationHistorySummary = summarizeHistoryPure(state.evaluationHistory || [], "Evaluation History", 5, truncFn);

    let currentContext = goalInfo.cumulativeGoal || "None";
    if (goalInfo.summaryContext) {
      currentContext += `\n\n--- Current Summary Context ---\n${goalInfo.summaryContext}`;
    }

    let prompt = corePromptTemplate
      .replace(/\[LSD_PERCENT\]/g, String(personaBalance))
      .replace(/\[PERSONA_MODE\]/g, primaryPersona)
      .replace(/\[CYCLE_COUNT\]/g, String(state.totalCycles))
      .replace(/\[AGENT_ITR_COUNT\]/g, String(state.agentIterations))
      .replace(/\[HUMAN_INT_COUNT\]/g, String(state.humanInterventions))
      .replace(/\[FAIL_COUNT\]/g, String(state.failCount))
      .replace(/\[LAST_FEEDBACK\]/g, truncFn(state.lastFeedback || "None", 500))
      .replace(/\[\[CRITIQUE_HISTORY_SUMMARY\]\]/g, critiqueHistorySummary)
      .replace(/\[\[CRITIQUE_FEEDBACK_SUMMARY\]\]/g, critiqueFeedbackSummary)
      .replace(/\[\[EVALUATION_HISTORY_SUMMARY\]\]/g, evaluationHistorySummary)
      .replace(/\[AVG_CONF\]/g, state.avgConfidence?.toFixed(2) || "N/A")
      .replace(/\[CRIT_FAIL_RATE\]/g, state.critiqueFailRate?.toFixed(1) + "%" || "N/A")
      .replace(/\[AVG_TOKENS\]/g, state.avgTokens?.toFixed(0) || "N/A")
      .replace(/\[AVG_EVAL_SCORE\]/g, state.avgEvalScore?.toFixed(2) || "N/A")
      .replace(/\[CTX_TOKENS\]/g, state.contextTokenEstimate?.toLocaleString() || "0")
      .replace(/\[CTX_TARGET\]/g, state.contextTokenTarget?.toLocaleString() || "~1M")
      .replace(/\[\[DYNAMIC_TOOLS_LIST\]\]/g, toolListSummary)
      .replace(/\[\[REGISTERED_WEB_COMPONENTS_LIST\]\]/g, registeredWebComponentsList)
      .replace(/\[\[RECENT_LOGS\]\]/g, truncFn(recentLogs, 1000))
      .replace(/\[\[ARTIFACT_LIST_WITH_PARADIGMS\]\]/g, artifactListSummary)
      .replace(/\[\[SEED_GOAL_DESC\]\]/g, truncFn(goalInfo.seedGoal || "None", 1000))
      .replace(/\[\[CUMULATIVE_GOAL_DESC\]\]/g, truncFn(currentContext, 4000))
      .replace(/\[\[SUMMARY_CONTEXT\]\]/g, truncFn(goalInfo.summaryContext || "None", 2000))
      .replace(/\[\[CURRENT_CONTEXT_FOCUS\]\]/g, goalInfo.currentContextFocus || "Full Goal Context")
      .replace(/\[\[ARTIFACT_CONTENT_SNIPPETS\]\]/g, artifactSnippets || "No relevant artifact snippets found or loaded.");
    return { prompt };
  };
  
  const prepareArtifactSnippetsPure = (allMetaMap, getArtifactContentFn, goalInfoType, truncFn) => {
      const relevantArtifacts = Object.keys(allMetaMap)
        .filter( (id) => allMetaMap[id]?.latestCycle >= 0 && (id.startsWith("target.") || (goalInfoType === "Meta" && id.startsWith("reploid."))) )
        .sort( (a, b) => (allMetaMap[b]?.latestCycle ?? -1) - (allMetaMap[a]?.latestCycle ?? -1) || a.localeCompare(b) )
        .slice(0, 10);
      let snippets = "";
      for (const id of relevantArtifacts) {
        const meta = allMetaMap[id];
        if (!meta) continue;
        const content = getArtifactContentFn(id, meta.latestCycle, meta.version_id);
        if (content !== null) {
          snippets += `\n---\nArtifact: ${id} (Cycle ${meta.latestCycle}${ meta.version_id ? ` V:${meta.version_id}` : "" } Paradigm: ${meta.paradigm || 'unknown'})\n${truncFn(content, 500)}\n---`;
        }
      }
      return snippets;
  };

  const assembleCritiquePromptPure = (template, llmProposal, goalInfo, truncFn) => {
      if (!template) return { error: "Critique prompt template missing." };
      const changes = llmProposal.artifact_changes || {};
      const modSummary = (changes.modified || []).map((a) => `${a.id}${a.version_id ? "#" + a.version_id : ""}`).join(", ") || "None";
      const newSummary = (changes.new || []).map((a) => `${a.id}(${a.type})${a.version_id ? "#" + a.version_id : ""}`).join(", ") || "None";
      const delSummary = (changes.deleted || []).join(", ") || "None";
      const modularSummary = (changes.modular || []).map((a) => `${a.id}${a.version_id ? "#" + a.version_id : ""}`).join(", ") || "None";
      const fullSourceSummary = changes.full_html_source ? "Yes" : "No";
      const pageCompositionSummary = changes.page_composition ? "Yes" : "No";
      const newToolsSummary = (llmProposal.proposed_new_tools || []).map((t) => t.declaration?.name || "?").join(", ") || "None";
      const newWebComponentTagNames = (llmProposal.tool_calls || []).filter((tc) => tc.name === "define_web_component" && tc.arguments?.tagName).map((tc) => tc.arguments.tagName).join(", ") || "None";
      
      // Note: Paradigms for modified/new/deleted artifacts would ideally be passed in or fetched based on IDs if needed here
      // For simplicity, this pure helper assumes they are already part of the llmProposal or handled by the orchestrator before calling this.
      // The prompt itself is updated to expect paradigm info via placeholders like [[MODIFIED_ARTIFACT_PARADIGMS]]

      const prompt = template
        .replace(/\[\[PROPOSED_CHANGES_DESC\]\]/g, truncFn(llmProposal.proposed_changes_description, 1000) || "None")
        .replace(/\[\[MODIFIED_ARTIFACT_IDS_VERSIONS\]\]/g, modSummary)
        .replace(/\[\[NEW_ARTIFACT_IDS_TYPES_VERSIONS\]\]/g, newSummary)
        .replace(/\[\[DELETED_ARTIFACT_IDS\]\]/g, delSummary)
        .replace(/\[\[MODULAR_ARTIFACT_IDS_VERSIONS\]\]/g, modularSummary)
        .replace(/\[\[HAS_FULL_HTML_SOURCE\]\]/g, fullSourceSummary)
        .replace(/\[\[HAS_PAGE_COMPOSITION\]\]/g, pageCompositionSummary)
        .replace(/\[\[NEW_TOOL_NAMES\]\]/g, newToolsSummary)
        .replace(/\[\[NEW_WEB_COMPONENT_TAG_NAMES\]\]/g, newWebComponentTagNames)
        .replace(/\[LATEST_GOAL_TYPE\]/g, goalInfo.type)
        .replace(/\[\[CUMULATIVE_GOAL_CONTEXT\]\]/g, truncFn(goalInfo.cumulativeGoal || goalInfo.summaryContext, 2000))
        .replace(/\[AGENT_CONFIDENCE\]/g, llmProposal.agent_confidence_score?.toFixed(3) ?? "N/A");
      return { prompt };
  };
  
  const assembleSummarizerPromptPure = (template, stateSummary, recentLogs, artifactListSummary, truncFn) => {
      if (!template) return { error: "Summarizer prompt template missing." };
      const prompt = template
        .replace(/\[\[AGENT_STATE_SUMMARY\]\]/g, JSON.stringify(stateSummary, null, 2))
        .replace(/\[\[RECENT_LOGS\]\]/g, truncFn(recentLogs, 1500))
        .replace(/\[\[LATEST_ARTIFACTS_WITH_PARADIGMS\]\]/g, artifactListSummary);
      return { prompt };
  };

  const checkHitlTriggersPure = (
    currentCycle, pauseAfterCycles, randomReviewProb, cycleTimeSecs, maxCycleTime,
    confidence, autoCritiqueThresh, isForcedReview, goalType, isMetaChangesEnabled,
    proposedCoreChanges // This would be a boolean derived from llmResponse in the orchestrator
  ) => {
    let hitlReason = null;
    let hitlModePref = "prompt";

    if (isForcedReview) hitlReason = "Forced Review";
    else if (pauseAfterCycles > 0 && currentCycle > 0 && currentCycle % pauseAfterCycles === 0) {
      hitlReason = `Auto Pause (Cycle ${currentCycle}/${pauseAfterCycles})`;
      hitlModePref = "options";
    } else if (Math.random() < randomReviewProb) {
      hitlReason = `Random Review (${(randomReviewProb * 100).toFixed(0)}%)`;
      hitlModePref = "critique_feedback";
    } else if (cycleTimeSecs > maxCycleTime) {
      hitlReason = `Time Limit Exceeded (${cycleTimeSecs.toFixed(1)}s > ${maxCycleTime}s)`;
    } else if (confidence < autoCritiqueThresh) {
      hitlReason = `Low Confidence (${confidence.toFixed(2)} < ${autoCritiqueThresh})`;
    }

    if (!hitlReason && isMetaChangesEnabled && goalType === "Meta" && proposedCoreChanges) {
        hitlReason = "Meta Change to Core Artifact or Page Structure";
        hitlModePref = "code_edit";
    }
    return hitlReason ? { reason: hitlReason, mode: hitlModePref } : null;
  };


  return {
    getArtifactListSummaryPure,
    getRegisteredWebComponentsListPure,
    getToolListSummaryPure,
    summarizeHistoryPure,
    assembleCorePromptPure,
    prepareArtifactSnippetsPure,
    assembleCritiquePromptPure,
    assembleSummarizerPromptPure,
    checkHitlTriggersPure
  };
})();