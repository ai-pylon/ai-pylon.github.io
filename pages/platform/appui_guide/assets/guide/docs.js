import { cachedApi, sectionHead } from "./helpers.js";
import { api, app, btn, el, esc, load } from "./state.js";

// ===================================================== DOCS ================
function renderDocs(host) {
  host.innerHTML = "";
  var wrap = el("div", { class: "g-wrap" });
  sectionHead(wrap, "📚 Framework docs",
    "Every reference doc in the repo, discovered (root AGENTS.md / README.md, <code>docs/*.md</code>, the <code>*.md</code> under <code>framework/appui</code>) plus the open <b>backlogs</b> (root <code>*_TODO.md</code>). Titles and purposes come from each doc itself.",
    "docs", function () { renderDocs(host); });
  var listCard = el("div", { class: "g-card g-doclist" });
  var viewer = el("div", { class: "g-doc", style: "margin-top:12px;display:none" });
  wrap.appendChild(listCard); wrap.appendChild(viewer);
  host.appendChild(wrap);
  cachedApi("docs", {}).then(function (r) {
    // sections + docs come from the framework doc catalog (framework/doc_catalog.py) - nothing listed here
    if (!r || !r.ok) { listCard.textContent = (r && r._error) || "docs failed"; return; }
    var titles = r.section_titles || {}, groups = {}, order = [];
    (r.docs || []).forEach(function (d) {
      if (!groups[d.section]) { groups[d.section] = []; order.push(d.section); }
      groups[d.section].push(d);
    });
    order.forEach(function (sec) {
      listCard.appendChild(el("div", { class: "g-grp-title" }, esc((titles[sec] || sec) + " (" + groups[sec].length + ")")));
      groups[sec].forEach(function (d) {
        var row = el("div");
        var link = el("button", { class: "btn sm g-doclink", title: d.path }, (sec === "backlog" ? "📝 " : "📄 ") + esc(d.title));
        link.onclick = function () {
          viewer.style.display = "block"; viewer.textContent = "Loading " + d.path + "…";
          // docs text is NOT client-cached: the op's etag path already makes a
          // repeat read cheap, and a backlog file changes as work lands.
          api("docs", { id: d.id }).then(function (rr) {
            if (!rr || !rr.ok) { viewer.textContent = (rr && rr._error) || "could not load"; return; }
            var txt = rr.text || "";
            // MORE_IMPROVEMENTS #15: render markdown via AppUICore.renderMarkdown with a per-doc TOC.
            if (window.AppUICore && typeof window.AppUICore.renderMarkdown === "function") {
              viewer.innerHTML = "";
              var headings = [];
              var body = el("div", { class: "g-doc-md", style: "line-height:1.55" });
              body.innerHTML = window.AppUICore.renderMarkdown(txt);
              Array.prototype.forEach.call(body.querySelectorAll("h1,h2,h3"), function (h, idx) {
                var hid = "doc-h-" + idx;
                h.id = hid;
                headings.push({ id: hid, level: Number(h.tagName.slice(1)), text: (h.textContent || "").trim() });
              });
              if (headings.length > 2) {
                var toc = el("nav", { class: "g-doc-toc", style: "margin-bottom:12px;padding:8px 10px;border:1px solid var(--appui-border,rgba(127,127,127,.25));border-radius:8px;font-size:12px" });
                toc.appendChild(el("div", { style: "font-weight:600;margin-bottom:4px" }, "Contents"));
                headings.forEach(function (h) {
                  var a = el("a", { href: "#" + h.id, style: "display:block;margin-left:" + ((h.level - 1) * 12) + "px;text-decoration:none;color:inherit;opacity:.85" }, esc(h.text));
                  a.onclick = function (ev) { ev.preventDefault(); var tgt = document.getElementById(h.id); if (tgt) tgt.scrollIntoView({ behavior: "smooth" }); };
                  toc.appendChild(a);
                });
                viewer.appendChild(toc);
              }
              viewer.appendChild(body);
            } else {
              viewer.textContent = txt;
            }
          });
        };
        row.appendChild(link);
        row.appendChild(el("span", { class: "g-sub", style: "margin-left:8px" }, esc(d.purpose || "") +
          ' <code class="g-bundle">' + esc(d.id) + "</code>"));
        listCard.appendChild(row);
      });
    });
  });
}

export { renderDocs };
