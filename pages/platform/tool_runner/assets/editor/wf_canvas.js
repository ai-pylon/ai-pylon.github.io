// WFCanvas - the visual flow: triggers, then steps top to bottom with nested containers (condition
// then/else, loop body, parallel branches, switch cases, try/catch, group). Every gap between nodes is an
// "add step" button AND a drop target; nodes are draggable (Shift-drop onto another node = parallel merge).
// Wires (dashed) join a step to every step that references {{steps.<id>}}. Zoom, pan, minimap, run-status overlay.
(function (root) {
  "use strict";
  var M = root.WFModel;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  var SVGNS = "http://www.w3.org/2000/svg";

  function create(opts) {
    var host = opts.container;
    var scale = 1, selection = null, statuses = {}, marks = {}, iterations = {};
    var view = el("div", "wf-viewport");
    var stage = el("div", "wf-stage");
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "wf-wires");
    var flow = el("div", "wf-flow");
    var mini = el("div", "wf-minimap");
    stage.appendChild(svg);
    stage.appendChild(flow);
    view.appendChild(stage);
    host.appendChild(view);
    host.appendChild(mini);

    // ── building blocks ──────────────────────────────────────────────────────
    function dropData(ev) {
      try { return JSON.parse(ev.dataTransfer.getData("application/x-wf") || "null"); } catch (e) { return null; }
    }
    function makeDropTarget(node, accept) {
      node.addEventListener("dragover", function (ev) {
        if (!ev.dataTransfer || ev.dataTransfer.types.indexOf("application/x-wf") < 0) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = ev.dataTransfer.effectAllowed === "copy" ? "copy" : "move";
        node.classList.add("wf-drop");
      });
      node.addEventListener("dragleave", function () { node.classList.remove("wf-drop"); });
      node.addEventListener("drop", function (ev) {
        node.classList.remove("wf-drop");
        var d = dropData(ev);
        if (!d) return;
        ev.preventDefault();
        ev.stopPropagation();
        accept(d, ev);
      });
    }
    function addButton(lp, index, empty) {
      var b = el("button", "wf-add" + (empty ? " wf-add-empty" : ""), empty ? "+ add step" : "+");
      b.type = "button";
      b.title = "Add a step here (or drop one)";
      b.addEventListener("click", function (ev) { ev.stopPropagation(); opts.onAdd(lp, index, b); });
      makeDropTarget(b, function (d) { opts.onDrop(d, lp, index, false, null); });
      return b;
    }
    function badge(cls, text, title) {
      var s = el("span", "wf-badge " + cls, text);
      if (title) s.title = title;
      return s;
    }

    function stepNode(step, path) {
      var k = M.kind(step), meta = M.KINDS[k] || {icon: "?", label: k};
      var key = M.pathKey(path);
      var n = el("div", "wf-node wf-kind-" + k + (k === "note" ? " wf-note" : ""));
      n.dataset.path = key;
      n.draggable = true;
      n.addEventListener("dragstart", function (ev) {
        ev.stopPropagation();
        ev.dataTransfer.setData("application/x-wf", JSON.stringify({from: path}));
        ev.dataTransfer.effectAllowed = "move";
        n.classList.add("wf-dragging");
      });
      n.addEventListener("dragend", function () { n.classList.remove("wf-dragging"); });
      makeDropTarget(n, function (d, ev) {
        if (d.from && ev.shiftKey) opts.onDrop(d, M.parentList(path), path[path.length - 1], true, path);
      });
      var head = el("div", "wf-head");
      head.appendChild(el("span", "wf-icon", meta.icon));
      var t = el("span", "wf-title", M.label(step));
      head.appendChild(t);
      var sub = M.subtitle(step);
      if (sub) head.appendChild(el("span", "wf-sub", sub));
      var right = el("span", "wf-badges");
      if (step._breakpoint) right.appendChild(badge("wf-bp", "●", "breakpoint"));
      if (step.on_error === "continue") right.appendChild(badge("wf-warn", "⚠", "continues on error"));
      if (step.when) right.appendChild(badge("wf-when", "?", "runs only when: " + step.when));
      if (step.retry) right.appendChild(badge("wf-retry", "↻", "retries"));
      if (step.timeout) right.appendChild(badge("wf-timeout", "⏱" + step.timeout, "timeout"));
      if (step.id) right.appendChild(badge("wf-id", "#" + step.id, "step id - referenced as {{steps." + step.id + "}}"));
      var st = el("span", "wf-status");
      right.appendChild(st);
      head.appendChild(right);
      n.appendChild(head);
      head.addEventListener("click", function (ev) { ev.stopPropagation(); opts.onSelect({type: "step", path: path}); });
      head.addEventListener("contextmenu", function (ev) { ev.preventDefault(); ev.stopPropagation(); opts.onContext(ev, {type: "step", path: path}); });
      if (M.isContainer(step)) {
        var body = el("div", "wf-body");
        M.slots(step).forEach(function (sl) {
          var slot = el("div", "wf-slot");
          var lab = el("div", "wf-slot-label", sl.label);
          if (sl.path[0] === "cases" && sl.path[1] !== "default" || sl.path[0] === "branches" && (step.branches || []).length > 1) {
            var x = el("button", "wf-x", "×");
            x.type = "button"; x.title = "Remove this " + (sl.path[0] === "cases" ? "case" : "branch");
            x.addEventListener("click", function (ev) { ev.stopPropagation(); opts.onRemoveSlot(path, sl.path); });
            lab.appendChild(x);
          }
          slot.appendChild(lab);
          slot.appendChild(listEl(sl.list, path.concat(sl.path)));
          body.appendChild(slot);
        });
        var kk = M.kind(step);
        if (kk === "switch" || kk === "parallel") {
          var more = el("button", "wf-slot-add", kk === "switch" ? "+ case" : "+ branch");
          more.type = "button";
          more.addEventListener("click", function (ev) { ev.stopPropagation(); opts.onAddSlot(path); });
          body.appendChild(more);
        }
        n.appendChild(body);
      }
      return n;
    }

    function listEl(list, lp) {
      var l = el("div", "wf-list");
      l.dataset.list = M.pathKey(lp);
      if (!list.length) { l.appendChild(addButton(lp, 0, true)); return l; }
      list.forEach(function (s, i) {
        l.appendChild(addButton(lp, i, false));
        l.appendChild(stepNode(s, lp.concat([i])));
      });
      l.appendChild(addButton(lp, list.length, false));
      return l;
    }

    function triggerNode(t, i) {
      var info = M.triggerLabel(t);
      var n = el("div", "wf-node wf-trigger");
      n.dataset.trigger = String(i);
      var head = el("div", "wf-head");
      head.appendChild(el("span", "wf-icon", {schedule: "⏰", event: "⚡", manual: "▶", webhook: "🔗", file_watch: "📂"}[t.type] || "▶"));
      head.appendChild(el("span", "wf-title", info.title + " trigger"));
      if (info.sub) head.appendChild(el("span", "wf-sub", info.sub));
      n.appendChild(head);
      head.addEventListener("click", function (ev) { ev.stopPropagation(); opts.onSelect({type: "trigger", index: i}); });
      head.addEventListener("contextmenu", function (ev) { ev.preventDefault(); ev.stopPropagation(); opts.onContext(ev, {type: "trigger", index: i}); });
      return n;
    }

    // ── render ───────────────────────────────────────────────────────────────
    function render() {
      var wf = opts.getWf();
      flow.replaceChildren();
      var trg = el("div", "wf-triggers");
      (wf.triggers || []).forEach(function (t, i) { trg.appendChild(triggerNode(t, i)); });
      var addT = el("button", "wf-add wf-add-trigger", "+ trigger");
      addT.type = "button";
      addT.addEventListener("click", function (ev) { ev.stopPropagation(); opts.onAddTrigger(addT); });
      trg.appendChild(addT);
      flow.appendChild(trg);
      flow.appendChild(listEl(wf.steps || (wf.steps = []), []));
      var end = el("div", "wf-end", "end");
      flow.appendChild(end);
      applySelection();
      applyStatuses();
      applyIterations();
      applyMarks();
      requestAnimationFrame(function () { drawWires(); drawMinimap(); });
    }

    function nodeFor(key) { return flow.querySelector('.wf-node[data-path="' + key + '"]'); }
    function applySelection() {
      flow.querySelectorAll(".wf-selected").forEach(function (n) { n.classList.remove("wf-selected"); });
      if (!selection) return;
      var n = selection.type === "trigger" ? flow.querySelector('.wf-node[data-trigger="' + selection.index + '"]')
                                           : nodeFor(M.pathKey(selection.path));
      if (n) n.classList.add("wf-selected");
    }
    function applyStatuses() {
      flow.querySelectorAll(".wf-node[data-path]").forEach(function (n) {
        var s = statuses[n.dataset.path], chip = n.querySelector(":scope > .wf-head .wf-status");
        n.classList.remove("wf-run-ok", "wf-run-error", "wf-run-running", "wf-run-paused", "wf-run-skipped", "wf-run-queued", "wf-run-partial", "wf-run-cancelled");
        if (!chip) return;
        chip.textContent = "";
        if (!s) return;
        n.classList.add("wf-run-" + s.status);
        chip.textContent = ({ok: "✓", error: "✗", running: "…", paused: "⏸", skipped: "↷", queued: "⏳", partial: "◐", cancelled: "■"}[s.status] || s.status) +
                           (s.ms != null ? " " + (s.ms >= 1000 ? (s.ms / 1000).toFixed(1) + "s" : Math.round(s.ms) + "ms") : "");
        chip.title = s.error || s.status;
      });
    }
    // loop run overlay: "‹ 2/5 ›" on a loop node picks which iteration the child statuses show
    function applyIterations() {
      flow.querySelectorAll(".wf-iter").forEach(function (n) { n.remove(); });
      Object.keys(iterations).forEach(function (key) {
        var it = iterations[key], n = nodeFor(key);
        if (!n || it.count < 2) return;
        var head = n.querySelector(":scope > .wf-head .wf-badges");
        if (!head) return;
        var box = el("span", "wf-iter");
        var prev = el("button", null, "‹"), next = el("button", null, "›");
        prev.type = next.type = "button";
        prev.disabled = it.index <= 0; next.disabled = it.index >= it.count - 1;
        prev.title = "previous iteration"; next.title = "next iteration";
        prev.addEventListener("click", function (ev) { ev.stopPropagation(); opts.onIterate(key, -1); });
        next.addEventListener("click", function (ev) { ev.stopPropagation(); opts.onIterate(key, 1); });
        box.appendChild(prev);
        box.appendChild(el("span", null, (it.index + 1) + "/" + it.count));
        box.appendChild(next);
        head.insertBefore(box, head.firstChild);
      });
    }
    function applyMarks() {
      flow.querySelectorAll(".wf-err,.wf-warning").forEach(function (n) { n.classList.remove("wf-err", "wf-warning"); });
      Object.keys(marks).forEach(function (k) {
        var n = nodeFor(k);
        if (n) n.classList.add(marks[k].level === "error" ? "wf-err" : "wf-warning");
        if (n) n.title = marks[k].message;
      });
    }

    // ── wires ────────────────────────────────────────────────────────────────
    function drawWires() {
      var wf = opts.getWf();
      svg.replaceChildren();
      var st = stage.getBoundingClientRect(), W = flow.scrollWidth + 80, H = flow.scrollHeight + 40;
      svg.setAttribute("width", W);
      svg.setAttribute("height", H);
      var lane = 0;
      M.wires(wf).forEach(function (w) {
        var a = nodeFor(M.pathKey(w.from)), b = nodeFor(M.pathKey(w.to));
        if (!a || !b) return;
        var ra = a.querySelector(":scope > .wf-head").getBoundingClientRect(), rb = b.querySelector(":scope > .wf-head").getBoundingClientRect();
        var x1 = (ra.right - st.left) / scale, y1 = (ra.top + ra.height / 2 - st.top) / scale;
        var x2 = (rb.right - st.left) / scale, y2 = (rb.top + rb.height / 2 - st.top) / scale;
        var bulge = 30 + (lane++ % 5) * 12;
        var p = document.createElementNS(SVGNS, "path");
        p.setAttribute("d", "M" + x1 + "," + y1 + " C" + (x1 + bulge) + "," + y1 + " " + (x2 + bulge) + "," + y2 + " " + x2 + "," + y2);
        p.setAttribute("class", "wf-wire");
        var tt = document.createElementNS(SVGNS, "title");
        tt.textContent = "{{steps." + w.id + "}} is used here";
        p.appendChild(tt);
        svg.appendChild(p);
      });
    }

    // ── minimap (only for longer flows, as in v1) ───────────────────────────
    function drawMinimap() {
      mini.replaceChildren();
      var tops = flow.querySelectorAll(".wf-list[data-list=''] > .wf-node");
      mini.style.display = tops.length >= 5 ? "" : "none";
      tops.forEach(function (n) {
        var d = el("button", "wf-dot");
        d.type = "button";
        d.title = n.querySelector(".wf-title").textContent;
        d.addEventListener("click", function () { n.scrollIntoView({block: "center", behavior: "smooth"}); });
        mini.appendChild(d);
      });
    }

    // ── zoom / pan ───────────────────────────────────────────────────────────
    function setScale(s) {
      scale = Math.max(0.3, Math.min(2, Math.round(s * 100) / 100));
      stage.style.transform = "scale(" + scale + ")";
      stage.style.transformOrigin = "0 0";
      stage.style.width = (100 / scale) + "%";
      if (opts.onZoom) opts.onZoom(scale);
      requestAnimationFrame(drawWires);
    }
    view.addEventListener("wheel", function (ev) {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      setScale(scale + (ev.deltaY < 0 ? 0.05 : -0.05));
    }, {passive: false});
    var pan = null;
    view.addEventListener("mousedown", function (ev) {
      if (ev.button !== 1) return;
      ev.preventDefault();
      pan = {x: ev.clientX, y: ev.clientY, l: view.scrollLeft, t: view.scrollTop};
    });
    window.addEventListener("mousemove", function (ev) { if (pan) { view.scrollLeft = pan.l - (ev.clientX - pan.x); view.scrollTop = pan.t - (ev.clientY - pan.y); } });
    window.addEventListener("mouseup", function () { pan = null; });
    view.addEventListener("click", function () { opts.onSelect(null); });

    return {
      render: render,
      select: function (sel) { selection = sel; applySelection(); },
      setStatuses: function (map) { statuses = map || {}; applyStatuses(); },
      setMarks: function (map) { marks = map || {}; applyMarks(); },
      setIterations: function (map) { iterations = map || {}; applyIterations(); },
      zoomBy: function (d) { setScale(scale + d); },
      zoomReset: function () { setScale(1); },
      fit: function () {
        var w = flow.scrollWidth + 60, h = flow.scrollHeight + 40;
        setScale(Math.min(1, view.clientWidth / w, view.clientHeight / h));
      },
      scale: function () { return scale; },
      reveal: function (path) { var n = nodeFor(M.pathKey(path)); if (n) n.scrollIntoView({block: "center", behavior: "smooth"}); },
      redrawWires: drawWires,
      el: view,
      destroy: function () { view.remove(); mini.remove(); }
    };
  }

  root.WFCanvas = {create: create};
})(window);
