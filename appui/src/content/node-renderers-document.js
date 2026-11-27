/* Built-in node presentations registered with the shared runtime registry. */
// document.heading — show section info
AppUINodeRenderers.register('document.heading', function(container, node, ctx) {
  var esc = ctx.esc || function(s) { return String(s||''); };
  var meta = node.metadata || {};
  var html = '<div style="font-size:12px">';
  html += '<div style="font-weight:bold;color:var(--accent);margin-bottom:4px">📖 ' + esc(node.description || node.key || '') + '</div>';
  if (meta.number) html += '<div><span style="color:var(--text-muted)">Section:</span> ' + esc(meta.number) + '</div>';
  if (meta.level) html += '<div><span style="color:var(--text-muted)">Level:</span> ' + meta.level + '</div>';
  if (meta.annotation) {
    var ann = meta.annotation;
    try { var parsed = JSON.parse(ann); ann = parsed.summary || ann; } catch(e) {}
    html += '<div style="margin-top:4px;padding:4px 6px;background:var(--bg-elevated);border-radius:3px;color:var(--text-muted);font-size:11px">' + esc(ann).substring(0, 300) + '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
});

// document.paragraph — show content preview
AppUINodeRenderers.register('document.paragraph', function(container, node, ctx) {
  var esc = ctx.esc || function(s) { return String(s||''); };
  var html = '<div style="font-size:12px">';
  html += '<div style="font-weight:bold;color:var(--color-success, #c3e88d);margin-bottom:4px">📝 Paragraph</div>';
  if (node.content) html += '<div style="color:var(--text-muted);font-size:11px;max-height:150px;overflow-y:auto">' + esc(node.content).substring(0, 500) + '</div>';
  else if (node.description) html += '<div style="color:var(--text-muted)">' + esc(node.description) + '</div>';
  html += '</div>';
  container.innerHTML = html;
});

