/* AppUIRagResults — shared RAG search-result rendering (WORKSPACE_APP_TODO #17).
 *
 * The workspace RAG tab (apps/knowledge/workspace page/src/77_rag.js) and the
 * standalone workspace_rag page (apps/knowledge/workspace_rag wsrag.js) each
 * hand-rolled the SAME hit UI: a cosine-score badge, cross-encoder rerank score
 * + a rank-movement (up/down) badge, a code vs prose hit card, and the "what
 * does rerank do" explainer. This factors that into ONE component so both pages
 * render identical result cards and the explainer lives in one place.
 *
 * API (all pure string/DOM helpers — no network, no page coupling):
 *   AppUIRagResults.esc(s)                      -> HTML-escaped string
 *   AppUIRagResults.scoreBadge(score)           -> cosine-similarity chip HTML
 *   AppUIRagResults.rerankBadges(hit, wasRank, nowRank) -> rr-score + up/down HTML
 *   AppUIRagResults.isSymbol(hit)               -> true for a code_func/class hit
 *   AppUIRagResults.rerankHelpHtml()            -> the "what rerank does" panel HTML
 *   AppUIRagResults.rankComparison(response, baseline) ->
 *       {applied, baseRankByNode, moved}; baseline is an optional search response.
 *   AppUIRagResults.hitCard(hit, opts)          -> one result card's HTML
 *       opts: { rel, line, reranked, wasRank, nowRank, openAttrs, contextAttrs }
 *         openAttrs    — extra attributes for the ↗ open link (caller wires click).
 *         contextAttrs — extra attributes for a 💬 "use as chat context" link
 *                        (caller wires click → add the hit's uri/rel to the next
 *                        turn's context). Omitted → no context link (#14).
 *
 * Styling is inline (theme vars) so it works on any AppUI page without a CSS
 * dependency. Both consumers keep their own click wiring; this only produces the
 * markup + the shared badges/explainer.
 */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function isSymbol(h) {
    if (!h) return false;
    if (h.type === "code_func" || h.type === "code_class") return true;
    var d = h.data || {};
    return h.type == null && !!d.qualified_name;
  }

  function scoreBadge(score) {
    return '<span style="font-family:ui-monospace,monospace;font-size:11px;color:var(--text-primary,#e6edf3);' +
      'background:color-mix(in srgb,var(--accent,#7aa2f7) 22%,transparent);border-radius:8px;padding:1px 6px" title="vector cosine similarity">' +
      esc(score) + '</span>';
  }

  // Keep the baseline's null state: no successful baseline is different from
  // a successful search with zero hits. Node IDs can be arbitrary strings.
  function rankComparison(response, baseline) {
    var ranks = null;
    if (baseline && baseline.ok) {
      ranks = Object.create(null);
      (baseline.results || []).forEach(function (hit, index) {
        if (hit.node_id != null) ranks[hit.node_id] = index + 1;
      });
    }
    var hits = (response && response.results) || [];
    var moved = 0;
    if (ranks) hits.forEach(function (hit, index) {
      var was = ranks[hit.node_id];
      if (was != null && was !== index + 1) moved++;
    });
    return {
      applied: /rerank/.test((response && response.mode) || ""),
      baseRankByNode: ranks,
      moved: moved,
    };
  }

  // rerank visibility: the cross-encoder score + how far rerank moved this hit
  // from the plain vector order (↑N up / ↓N down / = unchanged / new).
  function rerankBadges(hit, wasRank, nowRank) {
    var out = "";
    if (hit && hit.rerank_score != null) {
      out += '<span style="font-family:ui-monospace,monospace;font-size:10px;color:#d8b65a;' +
        'background:rgba(216,182,90,.14);border-radius:8px;padding:1px 6px" ' +
        'title="cross-encoder relevance score (what rerank ordered by)">rr ' +
        esc((+hit.rerank_score).toFixed(3)) + '</span>';
    }
    if (wasRank == null && nowRank != null) {
      out += '<span style="font-size:11px;color:#2e8b57;font-weight:700" title="new in the reranked top results">new</span>';
    } else if (wasRank != null && nowRank != null) {
      var delta = wasRank - nowRank;
      if (delta > 0) out += '<span style="font-size:11px;color:#2e8b57;font-weight:700" title="moved up from #' + wasRank + '">\u2191' + delta + '</span>';
      else if (delta < 0) out += '<span style="font-size:11px;color:var(--danger,#e0636e);font-weight:700" title="moved down from #' + wasRank + '">\u2193' + (-delta) + '</span>';
      else out += '<span style="font-size:11px;color:var(--text-muted,#9aa0a6)" title="unchanged">=</span>';
    }
    return out;
  }

  function rerankHelpHtml() {
    return '<div style="font-size:12px;line-height:1.55;color:var(--text-secondary,#c4ccd4);' +
      'border:1px solid var(--border,#3f4147);border-radius:8px;padding:10px">' +
      '<div style="font-weight:600;margin-bottom:4px;color:var(--text-primary,#e6edf3)">What \u201crerank\u201d does</div>' +
      'Search runs in two stages. <b>1. Recall (vector cosine)</b> \u2014 your query is embedded and ' +
      'compared to every passage\u2019s vector; fast, but it scores query and passage <i>separately</i>, so ' +
      'it can rank a passage that merely shares vocabulary above the one that truly answers you. ' +
      '<b>2. Rerank (cross-encoder, optional)</b> \u2014 the top matches are re-scored by a model that ' +
      'reads the query and passage <i>together</i> and outputs a direct relevance score, reordering the ' +
      'shortlist. Off by default (adds a model call, slower); turn it on for a hard query. When on, each ' +
      'result shows its cross-encoder score and a <b>\u2191/\u2193</b> badge for how far rerank moved it.' +
      '</div>';
  }

  // One result card. opts.openAttrs (optional) → an "open" link is rendered with
  // those extra attributes (the caller wires the click).
  function hitCard(hit, opts) {
    opts = opts || {};
    var sym = isSymbol(hit);
    var data = hit.data || {};
    var rel = opts.rel || hit.file || hit.rel_path || hit.doc_name || "";
    var line = (opts.line != null) ? opts.line : (sym ? data.line_start : null);
    var title = hit.title || hit.section || (rel ? String(rel).split("/").pop() : "(passage)");
    var repoTag = (data.repo)
      ? '<span style="font-family:ui-monospace,monospace;font-size:10px;color:var(--text-secondary,#c4ccd4);' +
        'border:1px solid var(--border,#3f4147);border-radius:8px;padding:0 5px" title="code symbol from a linked repo">code:' + esc(data.repo) + '</span>'
      : "";
    var symTag = sym
      ? '<span style="font-family:ui-monospace,monospace;font-size:10px;color:#d8b65a;' +
        'background:rgba(216,182,90,.14);border-radius:8px;padding:0 5px">' + esc((data.kind && data.kind !== "code.function") ? data.kind : "function") + '</span>'
      : "";
    var rr = opts.reranked ? rerankBadges(hit, opts.wasRank, opts.nowRank) : "";
    var section = (hit.section && hit.section !== title)
      ? '<div style="font-size:10px;color:var(--text-muted,#9aa0a6);margin-top:1px;word-break:break-word">\u00a7 ' + esc(hit.section) + '</div>' : "";
    var open = opts.openAttrs
      ? '<a href="#" class="airag-open" ' + opts.openAttrs +
        ' style="font-size:12px;color:var(--accent,#7aa2f7);margin-top:5px;display:inline-block">\u2197 open</a>' : "";
    // #14: a "use as chat context" affordance mirroring the tree menu's — hands
    // the chat the hit's ws-uri/rel so the model reads/searches it on demand.
    var ctx = opts.contextAttrs
      ? '<a href="#" class="airag-context" ' + opts.contextAttrs +
        ' title="add this passage\u2019s document to the chat context"' +
        ' style="font-size:11px;color:var(--text-secondary,#c4ccd4);margin-top:5px;margin-left:12px;display:inline-block">\uD83D\uDCAC context</a>' : "";
    return '<div class="airag-hit" style="border:1px solid var(--border,#3f4147);border-radius:6px;padding:8px;margin-bottom:6px;' +
      'background:var(--bg-elevated,transparent);color:var(--text-primary,inherit)">' +
      '<div style="display:flex;gap:6px;align-items:baseline;flex-wrap:wrap">' +
        scoreBadge(hit.score) + rr + symTag + repoTag +
        '<span style="font-weight:600;font-size:13px;word-break:break-word">' + esc(title) + '</span></div>' +
      section +
      (rel ? '<div style="font-size:11px;color:var(--text-muted,#9aa0a6);margin-top:2px;word-break:break-all">' + esc(rel) + (line ? ":" + esc(line) : "") + '</div>' : "") +
      '<div style="font-size:12px;line-height:1.45;color:var(--text-primary,#e6edf3);opacity:.9;margin-top:5px;white-space:pre-wrap;' +
        'word-break:break-word;max-height:6.5em;overflow:hidden">' + esc(hit.snippet || "") + '</div>' +
      open + ctx +
    '</div>';
  }

  window.AppUIRagResults = {
    esc: esc, isSymbol: isSymbol, scoreBadge: scoreBadge, rankComparison: rankComparison,
    rerankBadges: rerankBadges, rerankHelpHtml: rerankHelpHtml, hitCard: hitCard,
  };
})();
