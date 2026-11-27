/**
 * AI Tool/Workflow Usage Tracker
 *
 * Records which tools, groups, and workflows were in context for each prompt,
 * and which ones the LLM actually used (tool calls in response).
 * This data feeds back into improving tool/workflow selection suggestions.
 *
 * Storage: localStorage (ai_usage_signals)
 * Format: Array of signal entries, max 500 kept.
 *
 * Usage:
 *   AppUIUsageTracker.recordPrompt(prompt, enabledTools, enabledGroups, enabledWorkflows);
 *   AppUIUsageTracker.recordToolUse(toolName);
 *   AppUIUsageTracker.recordWorkflowSuggestion(workflowName);
 *   AppUIUsageTracker.commit();  // saves the current interaction
 *
 *   AppUIUsageTracker.getRecommendations(prompt) → {tools: [...], groups: [...], workflows: [...]}
 */
const AppUIUsageTracker = (function() {
  'use strict';

  const STORAGE_KEY = 'ai_usage_signals';
  const MAX_SIGNALS = 500;

  let _signals = [];
  let _current = null; // current in-flight interaction

  function _load() {
    _signals = AppUIStorage.getJSON(STORAGE_KEY, []);
    if (!Array.isArray(_signals)) _signals = [];
  }

  function _save() {
    if (_signals.length > MAX_SIGNALS) _signals = _signals.slice(-MAX_SIGNALS);
    AppUIStorage.setJSON(STORAGE_KEY, _signals);
  }

  /**
   * Start tracking a new prompt interaction.
   * @param {string} prompt - The user's prompt text
   * @param {Array} enabledTools - Tool names in context
   * @param {Array} enabledGroups - Group names in context
   * @param {Array} enabledWorkflows - Workflow names in context
   */
  function recordPrompt(prompt, enabledTools, enabledGroups, enabledWorkflows) {
    _current = {
      ts: Date.now(),
      prompt: prompt.slice(0, 200), // truncate for storage
      promptTokens: prompt.split(/\s+/).slice(0, 10), // first 10 words for matching
      context: {
        tools: (enabledTools || []).map(t => typeof t === 'string' ? t : t.name),
        groups: (enabledGroups || []).map(g => typeof g === 'string' ? g : g.name),
        workflows: (enabledWorkflows || []).map(w => typeof w === 'string' ? w : w.name),
      },
      used: {
        tools: [],
        workflows: [],
      },
    };
  }

  /**
   * Record that the LLM used/called a specific tool.
   * @param {string} toolName - Tool that was called
   */
  function recordToolUse(toolName) {
    if (!_current) return;
    if (!_current.used.tools.includes(toolName)) {
      _current.used.tools.push(toolName);
    }
  }

  /**
   * Record that the LLM suggested/triggered a workflow.
   * @param {string} workflowName - Workflow that was suggested
   */
  function recordWorkflowSuggestion(workflowName) {
    if (!_current) return;
    if (!_current.used.workflows.includes(workflowName)) {
      _current.used.workflows.push(workflowName);
    }
  }

  /**
   * Commit the current interaction to storage.
   * Call after the LLM response is complete.
   */
  function commit() {
    if (!_current) return;
    // Only save if something was actually used (training signal)
    if (_current.used.tools.length || _current.used.workflows.length) {
      _signals.push(_current);
      _save();
    }
    _current = null;
  }

  /**
   * Discard the current interaction without saving.
   */
  function discard() {
    _current = null;
  }

  /**
   * Get recommendations for which tools/groups/workflows to enable
   * based on historical usage patterns for similar prompts.
   *
   * @param {string} prompt - The current user prompt
   * @returns {{tools: string[], groups: string[], workflows: string[]}}
   */
  function getRecommendations(prompt) {
    return window._AIUsageTrackerModel.getRecommendations(_signals,prompt);
  }

  /**
   * Get usage statistics.
   * @returns {{totalSignals: number, topTools: Array, topWorkflows: Array}}
   */
  function stats() {
    return window._AIUsageTrackerModel.stats(_signals);
  }

  /**
   * Clear all stored signals.
   */
  function clear() {
    _signals = [];
    _save();
  }

  // Initialize
  _load();

  return {
    recordPrompt,
    recordToolUse,
    recordWorkflowSuggestion,
    commit,
    discard,
    getRecommendations,
    stats,
    clear,
  };
})();

if (typeof window !== 'undefined') window.AppUIUsageTracker = AppUIUsageTracker;
