import { cachedApi, debounce, sectionHead } from "./helpers.js";
import { el, esc, load } from "./state.js";

// The gallery lists NOTHING by hand: every card comes from the AppUI framework's
// catalog (catalog op -> framework/appui_catalog.py) - the component, its src
// folder, bundle + deps, header description / usage, and the URL of the demo the
// component keeps next to its source (<name>.demo.js, registered via AppUIDemos).

function loadAll(names) {
  return names.reduce(function (p, b) { return p.then(function () { return load(b); }); }, Promise.resolve());
}

function card(it, owner) {
  var c = el("div", { class: "g-card", "data-global": it.global });
  var meta = [it.global, it.folder ? "src/" + it.folder : "src", it.bundle ? "bundle: " + it.bundle : "no bundle (portable/core)"];
  if (it.deps && it.deps.length) meta.push("deps: " + it.deps.join(", "));
  c.appendChild(el("h3", null, esc(it.name) + ' <span class="g-bundle">' + esc(meta.join(" · ")) + "</span>"));
  var blurb = el("div", { class: "g-blurb" }, esc(it.description || "(no header description in " + it.file + ")"));
  c.appendChild(blurb);
  var demoRow = el("div", { class: "g-row" });
  c.appendChild(demoRow);
  var code = el("pre", { class: "g-code" }, esc(it.usage || ""));
  if (!it.usage) code.style.display = "none";
  c.appendChild(code);
  var src = el("div", { class: "g-sub", style: "margin-top:4px" },
    '<a href="' + esc(it.file) + '" target="_blank" rel="noopener">' + esc(it.file) + "</a>" +
    (it.demo ? ' · demo <a href="' + esc(it.demo) + '" target="_blank" rel="noopener">' + esc(it.demo.split("/").pop()) + "</a>" : " · no demo yet"));
  c.appendChild(src);
  var mounted = false, cleanup = null;
  c._mount = function () {
    if (mounted || !it.demo || !owner.current()) return;
    mounted = true;
    demoRow.textContent = "loading demo…";
    var own = it.bundle ? [it.bundle] : [];
    load("demos").then(function () { return loadAll(own); })
      .then(function () { return window.AppUIDemos.load(it.demo); })
      .then(function () {
        var spec = window.AppUIDemos.get(it.global);
        if (!spec) throw new Error(it.demo + " registered no demo for " + it.global);
        return loadAll(spec.needs || []).then(function () { return spec; });
      })
      .then(function (spec) {
        if (!owner.current() || !mounted) return;
        demoRow.textContent = "";
        if (spec.what) blurb.innerHTML = esc(spec.what);
        if (spec.code) { code.textContent = spec.code; code.style.display = ""; }
        cleanup = window.AppUIDemos.mount(it.global, demoRow);
        owner.add(function () { if (cleanup) { try { cleanup(); } catch (_e) {} cleanup = null; } });
      })
      .catch(function (e) { if (owner.current()) demoRow.textContent = "demo failed: " + e; });
  };
  // MORE_IMPROVEMENTS #13: allow tearing down off-screen demos so many chart/table demos aren't alive at once.
  c._unmount = function () {
    if (!mounted) return;
    mounted = false;
    if (cleanup) { try { cleanup(); } catch (_e) {} cleanup = null; }
    demoRow.textContent = "";
  };
  return c;
}

function renderGallery(host) {
  host.innerHTML = "";
  var wrap = el("div", { class: "g-wrap" });
  sectionHead(wrap, "🧩 Component gallery",
    "Every AppUI component the framework defines, grouped by its folder under <code>framework/appui/src</code>. Descriptions come from each file's header comment; a live demo appears when the component keeps a <code>&lt;name&gt;.demo.js</code> next to its source (<code>AppUIDemos.register</code>).",
    "catalog", function () { renderGallery(host); });
  var bar = el("div", { class: "g-row" });
  var filter = el("input", { placeholder: "🔍 filter by name, folder, bundle or text…", class: "g-filter" });
  var demoLbl = el("label", { class: "g-sub", style: "display:flex;gap:4px;align-items:center" });
  var demoBox = el("input", { type: "checkbox" });
  demoLbl.appendChild(demoBox); demoLbl.appendChild(document.createTextNode("only with a live demo"));
  var intLbl = el("label", { class: "g-sub", style: "display:flex;gap:4px;align-items:center" });
  var intBox = el("input", { type: "checkbox" });
  intLbl.appendChild(intBox); intLbl.appendChild(document.createTextNode("show @internal"));
  var count = el("span", { class: "g-sub" }, "Loading…");
  bar.appendChild(filter); bar.appendChild(demoLbl); bar.appendChild(intLbl); bar.appendChild(count);
  wrap.appendChild(bar);
  var groupsHost = el("div", { style: "margin-top:8px" });
  wrap.appendChild(groupsHost);
  host.appendChild(wrap);
  var owner = window.AppUILifecycle.createViewScope({ host: wrap });
  var io = (typeof IntersectionObserver === "function") ? new IntersectionObserver(function (entries) {
    entries.forEach(function (ent) {
      if (ent.isIntersecting) { if (ent.target._mount) ent.target._mount(); }
      else if (ent.target._unmount) { ent.target._unmount(); }
    });
  }, { rootMargin: "600px" }) : null;
  if (io) owner.add(function () { io.disconnect(); });

  cachedApi("catalog", {}).then(function (r) {
    if (!owner.current()) return;
    if (!r || !r.ok) { count.textContent = (r && r._error) || "catalog failed"; return; }
    var byGlobal = {};
    (r.items || []).forEach(function (it) { byGlobal[it.global] = it; });
    // MORE_IMPROVEMENTS #49: collapse folders by default and build each folder's cards lazily on first expand.
    var groups = (r.folders || []).map(function (f) {
      var sec = el("div", { class: "g-folder", "data-folder": f.folder });
      var head = el("button", { type: "button", class: "g-grp-title g-folder-head",
                                style: "display:block;width:100%;text-align:left;background:none;border:0;cursor:pointer;padding:6px 0" });
      var body = el("div");
      sec.appendChild(head); sec.appendChild(body);
      var rawItems = f.globals.map(function (g) { return byGlobal[g]; }).filter(Boolean).map(function (it) {
        return {
          it: it,
          key: (it.global + " " + it.folder + " " + (it.bundle || "") + " " + (it.description || "")).toLowerCase(),
          hasDemo: !!it.demo,
          internal: !!it.internal,
        };
      });
      var built = false, cards = [];
      function ensureBuilt() {
        if (built) return;
        built = true;
        cards = rawItems.map(function (m) {
          var c = card(m.it, owner);
          c._key = m.key; c._hasDemo = m.hasDemo; c._internal = m.internal;
          body.appendChild(c);
          if (io) io.observe(c); else c._mount();
          return c;
        });
      }
      var label = "📁 src/" + (f.folder || ".");
      var disc = null;
      if (window.AppUIDisclosure) {
        disc = window.AppUIDisclosure.bind({ trigger: head, panel: body, expanded: false });
        owner.add(disc.destroy);
      } else {
        body.hidden = true;
      }
      head.addEventListener("click", function () { ensureBuilt(); apply(); });
      groupsHost.appendChild(sec);
      return { sec: sec, head: head, body: body, label: label, rawItems: rawItems,
               ensureBuilt: ensureBuilt, getCards: function () { return cards; }, disc: disc };
    });
    function apply() {
      var q = (filter.value || "").trim().toLowerCase(), only = demoBox.checked, showInt = intBox.checked, shown = 0, demos = 0;
      groups.forEach(function (g) {
        var n = 0, d = 0;
        if (q) g.ensureBuilt();
        var cards = g.getCards();
        if (cards.length) {
          cards.forEach(function (c) {
            var vis = (!q || c._key.indexOf(q) >= 0) && (!only || c._hasDemo) && (showInt || !c._internal);
            c.style.display = vis ? "" : "none";
            if (vis) { n++; if (c._hasDemo) d++; }
          });
        } else {
          g.rawItems.forEach(function (m) {
            var vis = (!q || m.key.indexOf(q) >= 0) && (!only || m.hasDemo) && (showInt || !m.internal);
            if (vis) { n++; if (m.hasDemo) d++; }
          });
        }
        g.sec.style.display = n ? "" : "none";
        g.head.textContent = g.label + "  (" + n + (d ? ", " + d + " with demo" : "") + ")";
        shown += n; demos += d;
      });
      count.innerHTML = "<b>" + shown + "</b> of " + r.count + " components · " + r.with_demo + " with a live demo";
    }
    apply();
    var later = debounce(apply, 120);
    owner.add(later.destroy);
    owner.listen(filter, "input", later);
    owner.listen(demoBox, "change", apply);
    owner.listen(intBox, "change", apply);
  });
}

export { renderGallery };
