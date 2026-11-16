/** Response directives and conversation notices; no execution state. */
export function createTaskProtocol(tools) {
  const { normalizePlanId, normalizePlanDeps } = tools;
  const extractPrefixedLine = (text, prefixes) => {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      for (const prefix of prefixes) {
        const marker = `${prefix.toUpperCase()}:`;
        if (line.toUpperCase().startsWith(marker)) {
          return line.slice(marker.length).trim();
        }
      }
    }

    return null;
  };

  const getMessageLabel = (message = {}) => {
    const origin = String(message.origin || '').toLowerCase();
    if (origin === 'bootstrap') return 'BOOT';
    if (origin === 'model') return 'MODEL';
    if (origin === 'tool') return 'TOOL';
    if (origin === 'system') return 'SYSTEM';
    return String(message.role || 'unknown').toUpperCase();
  };

  const formatContextMessage = (message = {}) => {
    const content = String(message.content || '').trim();
    const label = getMessageLabel(message);
    if (!content) {
      return `[${label}]`;
    }

    // Tool and system observations already carry a structured prefix that is useful
    // both to the model and to the human transcript.
    if (content.startsWith('[TOOL ') || content.startsWith('[SYSTEM')) {
      return content;
    }

    return `[${label}]\n${content}`.trim();
  };

  const parseSelfDirective = (callsFromResponse, text) => {
    const cleaned = String(text || '').trim();
    if (!cleaned && !callsFromResponse.length) return null;

    const calls = callsFromResponse.map((call) => ({
      name: String(call?.name || '').trim(),
      args: call?.args && typeof call.args === 'object' ? call.args : {},
      id: normalizePlanId(call?.id),
      after: normalizePlanDeps(call?.after),
      error: call?.error || null
    })).filter((call) => call.name);

    const milestoneReason = extractPrefixedLine(cleaned, ['MILESTONE', 'DONE']);
    const idleReason = extractPrefixedLine(cleaned, ['IDLE', 'PARK']);

    if (calls.length > 0) {
      return {
        type: 'tools',
        calls,
        milestoneReason,
        idleReason
      };
    }

    if (idleReason !== null) {
      return {
        type: 'idle',
        reason: idleReason,
        wakeOn: 'manual'
      };
    }

    if (milestoneReason !== null) {
      return {
        type: 'done',
        reason: milestoneReason
      };
    }

    return null;
  };

  const buildSystemNotice = (message) => `[SYSTEM]\n${String(message || '').trim()}`.trim();

  const withTerminalPunctuation = (value) => {
    const text = String(value || '').trim();
    if (!text) return '';
    return /[.!?]$/.test(text) ? text : `${text}.`;
  };

  const buildMilestoneNotice = (reason) => buildSystemNotice(
    reason
      ? `Milestone recorded: ${withTerminalPunctuation(reason)} Policy unchanged: execution remains resumable until you stop it or the cycle limit is reached.`
      : 'Milestone recorded. Policy unchanged: execution remains resumable until you stop it or the cycle limit is reached.'
  );

  const buildParkNotice = (reason, wakeOn = 'manual') => buildSystemNotice(
    reason
      ? `Waiting: ${withTerminalPunctuation(reason)} Resume when new work is available. Wake condition: ${wakeOn}.`
      : `Waiting. Resume when new work is available. Wake condition: ${wakeOn}.`
  );
  return { formatContextMessage, parseSelfDirective, buildSystemNotice, buildMilestoneNotice, buildParkNotice };
}
