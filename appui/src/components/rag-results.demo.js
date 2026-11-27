/* Gallery demo for rag-results.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "RagResults",
    global: "AppUIRagResults",
    what: "Shared RAG hit cards: cosine-score + rerank badges, code/prose card, and the 'what rerank does' explainer — one implementation for every RAG page.",
    code: "await AppUIAssets.load('ragResults');\nhost.innerHTML = AppUIRagResults.hitCard(hit, { reranked:true, wasRank:3, nowRank:1,\n  openAttrs:'data-rel=\"src/x.c\"' });\n// or the explainer panel:\nhost.innerHTML = AppUIRagResults.rerankHelpHtml();",
    demo: function (host) {
      if (!window.AppUIRagResults) { host.textContent = "load the ragResults bundle first"; return; }
      var hit = { score: 0.912, title: "allocateResourcePartition", type: "code_func",
        data: { repo: "ebb", relPath: "src/sched/alloc.c", line_start: 142, kind: "function" },
        rerank_score: 0.88,
        snippet: "int allocateResourcePartition(Cell* c, int weight) { /* applies the RP offset */ }" };
      var prose = { score: 0.804, title: "Basic RRP in Scheduler", type: "paragraph",
        section: "Weight offset", snippet: "When RRP is introduced, cell weights get an add-on bit by default." };
      var wrap = document.createElement("div");
      wrap.style.cssText = "max-width:560px";
      wrap.innerHTML =
        AppUIRagResults.hitCard(hit, { reranked: true, wasRank: 4, nowRank: 1, openAttrs: 'data-rel="src/sched/alloc.c"' })
        + AppUIRagResults.hitCard(prose, {})
        + AppUIRagResults.rerankHelpHtml();
      host.appendChild(wrap);
    },
  });
})();
