/* Usage scoring and summaries; recording and persistence stay in the tracker. */
window._AIUsageTrackerModel = (() => {
  const RECENCY_WEIGHT = 0.8;
  function getRecommendations(signals,prompt) {
    if (!signals.length) return {tools: [], groups: [], workflows: []};

    const promptWords = new Set(prompt.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const now = Date.now();

    // Score each signal by prompt similarity + recency
    const toolScores = Object.create(null);
    const groupScores = Object.create(null);
    const workflowScores = Object.create(null);

    signals.forEach(signal => {
      // Similarity: word overlap between current prompt and historical prompt
      const signalWords = (signal.promptTokens || []).map(w => w.toLowerCase());
      const overlap = signalWords.filter(w => promptWords.has(w)).length;
      if (overlap === 0) return; // no relevance

      // Recency: exponential decay (half-life ~7 days)
      const ageMs = now - (signal.ts || 0);
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const recency = Math.pow(RECENCY_WEIGHT, ageDays / 7);

      const score = overlap * recency;

      // Credit tools that were actually used
      (signal.used.tools || []).forEach(t => {
        toolScores[t] = (toolScores[t] || 0) + score * 2; // used = strong signal
      });
      // Credit tools that were in context (weaker signal)
      (signal.context.tools || []).forEach(t => {
        if (!(signal.used.tools || []).includes(t)) {
          toolScores[t] = (toolScores[t] || 0) + score * 0.1; // in context but unused = weak
        }
      });
      // Groups
      (signal.context.groups || []).forEach(g => {
        const hasUsedTool = (signal.used.tools || []).some(t => t.startsWith(g + '.'));
        groupScores[g] = (groupScores[g] || 0) + score * (hasUsedTool ? 2 : 0.2);
      });
      // Workflows
      (signal.used.workflows || []).forEach(w => {
        workflowScores[w] = (workflowScores[w] || 0) + score * 2;
      });
    });

    // Sort and return top recommendations
    const sortByScore = (obj, limit) =>
      Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name]) => name);

    return {
      tools: sortByScore(toolScores, 20),
      groups: sortByScore(groupScores, 10),
      workflows: sortByScore(workflowScores, 5),
    };
  }

  function stats(signals) {
    const toolCounts = Object.create(null);
    const wfCounts = Object.create(null);
    signals.forEach(s => {
      (s.used.tools || []).forEach(t => { toolCounts[t] = (toolCounts[t] || 0) + 1; });
      (s.used.workflows || []).forEach(w => { wfCounts[w] = (wfCounts[w] || 0) + 1; });
    });
    const sortTop = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({name, count}));
    return {
      totalSignals: signals.length,
      topTools: sortTop(toolCounts, 15),
      topWorkflows: sortTop(wfCounts, 10),
    };
  }

  return {getRecommendations,stats};
})();
