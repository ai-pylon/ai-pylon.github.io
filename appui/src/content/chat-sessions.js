/* Session orchestration around Chat storage; active conversation state stays in Chat. */
window._AppUIChatSessions = {
  create({options,getState,setState,setConversationId,isDestroyed,invalidate,render}) {
    const storage=window._AppUIChatStorage.create(), records=window._AppUIChatRecords;
    function persist() {
      if(isDestroyed())return;
      const state=getState();
      if(!state.conversationId){state.conversationId=records.messageId();setConversationId(state.conversationId);}
      storage.persist({...state,backend:options.backend,model:options.model});
    }
    function save() {
      if(isDestroyed())return;
      const {history,sessionId}=getState();storage.saveHistory(history,sessionId);persist();
    }
    function apply(session,resetReplay=false) {
      setState({conversationId:session.id,history:records.normalizeHistory(session.history),sessionId:session.session_id || null},resetReplay);
      if(session.backend)options.backend=session.backend;
      if(session.model)options.model=session.model;
    }
    function restore() {
      try {
        const sessions=storage.sessions(),currentId=storage.currentId();
        const current=sessions.find(session=>session.id===currentId);
        if(current)apply(current);
        else {
          const stored=storage.legacyHistory();
          setState({conversationId:records.messageId(),history:records.normalizeHistory(stored || []),sessionId:storage.legacySessionId()});
          save();
        }
        render();
      } catch {}
    }
    function list() {persist();return records.sessions(storage.sessions(),getState().conversationId);}
    function load(id) {
      if(isDestroyed())return false;
      const session=storage.sessions().find(item=>item.id===id);if(!session)return false;
      invalidate();apply(session,true);save();render();return true;
    }
    function clear() {
      if(isDestroyed())return;
      invalidate();storage.clearSessions();
      setState({history:[],sessionId:null,conversationId:records.messageId()},true);
      render();save();
    }
    return {persist,save,restore,list,load,clear};
  }
};
