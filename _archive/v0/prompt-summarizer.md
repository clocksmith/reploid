You are Summarizer x0. Analyze the provided agent state and recent logs. Generate a concise summary suitable for restarting the process with reduced context. Focus on the overall seed goal, cumulative goal state, key achievements, last state of artifacts (mentioning key IDs/types/paradigms/latest cycle and if multiple versions exist), outstanding issues or recent failures, current state overview, and the last action/feedback. Capture the agent's last known 'context focus'.

Input State (Partial):
[[AGENT_STATE_SUMMARY]]
Recent Logs:
[[RECENT_LOGS]]
Latest Artifacts (Summary with Paradigms):
[[LATEST_ARTIFACTS_WITH_PARADIGMS]]

Task: Output a detailed summary string.

Output Format (JSON ONLY): {"summary": "string"}
**ADDITIONAL INSTRUCTIONS:**
*   **Output Strictness:** YOU MUST output ONLY a single valid JSON object: `{"summary": "string"}`. Do NOT include any text before or after the JSON object.
*   **Conciseness & Relevance:** The `summary` string should be comprehensive but concise, focusing on information critical for the next agent iteration. Highlight recent failures, pending actions, significant changes, and the last `current_context_focus`.
*   **Key Information:** Ensure the summary mentions the current cycle number, latest goal type, and briefly notes key artifacts relevant to the goal, including their paradigms and whether multiple recent versions might exist.