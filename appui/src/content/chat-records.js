/* Message normalization and saved-session display records for shared Chat. */
window._AppUIChatRecords=(function(){
    function _messageId() {
      return globalThis.crypto?.randomUUID?.()
        || `message-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function _historyMessage(role, content, metadata = {}) {
      return Object.assign({
        id: _messageId(),
        role,
        content,
        timestamp: new Date().toISOString(),
        parent_id: null,
        replay_of: null,
      }, metadata);
    }

    function _normalizeHistory(messages) {
      if (!Array.isArray(messages)) return [];
      return messages.filter(message => message && message.role && typeof message.content === 'string')
        .map((message, index) => Object.assign({
          id: `legacy-${index}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: null,
          parent_id: null,
          replay_of: null,
        }, message));
    }

    function _sessionTitle(history) {
      const first = history.find(message => message.role === 'user') || history[0];
      const text = String(first?.content || '').replace(/\s+/g, ' ').trim();
      return text ? (text.length > 88 ? `${text.slice(0, 87)}\u2026` : text) : 'New chat';
    }

    function sessionRecords(sessions,currentId){
      return sessions.map(session => ({
        id: session.id,
        title: session.title || 'New chat',
        updated_at: session.updated_at || null,
        message_count: session.history.length,
        session_id: session.session_id || null,
        current: session.id === currentId,
      }));
    }
    return {messageId:_messageId,message:_historyMessage,normalizeHistory:_normalizeHistory,title:_sessionTitle,sessions:sessionRecords};
})();
