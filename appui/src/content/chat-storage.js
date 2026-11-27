/* Per-page conversation persistence. Streaming and active state belong to Chat. */
window._AppUIChatStorage = (() => {
  function create({getPath = () => window.location.pathname} = {}) {
    const key = () => 'ai-chat-history:' + getPath();
    const sessionsKey = () => key() + ':sessions';
    const currentKey = () => key() + ':current-session';
    function sessions() {
      const saved = AppUIStorage.getJSON(sessionsKey(), []);
      return Array.isArray(saved) ? saved.filter(session => session?.id && Array.isArray(session.history)) : [];
    }
    function persist({conversationId, history, sessionId, backend, model}) {
      AppUIStorage.set(currentKey(), conversationId);
      if (!history.length) return;
      const saved = sessions().filter(session => session.id !== conversationId);
      saved.unshift({
        id: conversationId,
        title: window._AppUIChatRecords.title(history),
        updated_at: new Date().toISOString(),
        history: history.slice(),
        session_id: sessionId,
        backend,
        model: model || '',
      });
      AppUIStorage.setJSON(sessionsKey(), saved.slice(0, 50));
    }
    function saveHistory(history, sessionId) {
      AppUIStorage.setJSON(key(), history);
      if (sessionId) AppUIStorage.set(key() + ':sid', sessionId);
      else AppUIStorage.remove(key() + ':sid');
    }
    function clearSessions() {
      AppUIStorage.remove(sessionsKey());
      AppUIStorage.remove(currentKey());
    }
    return {sessions, persist, saveHistory, clearSessions,
      currentId: () => AppUIStorage.get(currentKey()),
      legacyHistory: () => AppUIStorage.getJSON(key(), []),
      legacySessionId: () => AppUIStorage.get(key() + ':sid'),
    };
  }
  return {create};
})();
