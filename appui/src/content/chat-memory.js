/* Shared Chat memory storage and recognition policies; independent of DOM rendering. */
window._AppUIChatMemory=(function(){
  'use strict';
  const MEMORY_KEY = 'ai-memory';
  const MEMORY_MAX = 50;

  // --- Memory System ---
  function getMemories() {
    const memories = AppUIStorage.getJSON(MEMORY_KEY, []);
    return Array.isArray(memories) ? memories : [];
  }

  function saveMemories(memories) {
    if (memories.length > MEMORY_MAX) memories = memories.slice(-MEMORY_MAX);
    AppUIStorage.setJSON(MEMORY_KEY, memories);
  }

  function addMemory(fact, source) {
    const memories = getMemories();
    if (memories.some(m => m.fact === fact)) return;
    const category = categorizeMemory(fact);
    memories.push({fact, created: new Date().toISOString(), source_page: source || window.location.pathname, category});
    saveMemories(memories);
  }

  function deleteMemory(idx) {
    const memories = getMemories();
    memories.splice(idx, 1);
    saveMemories(memories);
  }

  function categorizeMemory(fact) {
    const f = fact.toLowerCase();
    if (/prefer|like|want|always|never|style|format/.test(f)) return 'preference';
    if (/remind|todo|don't forget|deadline|by \w+day/.test(f)) return 'reminder';
    if (/working on|current|project|task|sprint/.test(f)) return 'context';
    return 'fact';
  }

  function buildMemoryContext() {
    const memories = getMemories();
    if (!memories.length) return '';
    const recent = memories.slice(-10);
    return '\n\n[User Memories]\n' + recent.map(m => `- ${m.fact}`).join('\n');
  }

  function detectRememberCommand(msg) {
    const patterns = [
      /^remember\s+(?:that\s+)?(.+)/i,
      /^remember:\s*(.+)/i,
      /^(?:note|save|store)(?:\s+that)?\s*[:.]?\s*(.+)/i,
    ];
    for (const p of patterns) {
      const m = msg.match(p);
      if (m) return m[1].trim();
    }
    return null;
  }

  function detectAIRememberResponse(reply, lastUserMsg) {
    if (!lastUserMsg) return;
    const patterns = [/i'?ll remember/i, /i'?ve noted/i, /noted[.!]/i, /i'?ll keep that in mind/i, /stored in memory/i];
    for (const p of patterns) {
      if (p.test(reply)) { addMemory(lastUserMsg, window.location.pathname); return; }
    }
  }

  return {getMemories,addMemory,deleteMemory,buildMemoryContext,detectRememberCommand,detectAIRememberResponse};
})();
