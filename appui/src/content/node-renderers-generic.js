/* Built-in node presentations registered with the shared runtime registry. */
// path.folder — show folder info
AppUINodeRenderers.register('path.folder', function(container, node, ctx) {
  var esc = ctx.esc || function(s) { return String(s||''); };
  var meta = node.metadata || {};
  var html = '<div style="font-size:12px">';
  html += '<div style="font-weight:bold;color:var(--color-warning);margin-bottom:4px">📁 ' + esc(node.key || '') + '</div>';
  if (meta.disk_path) html += '<div style="color:var(--text-muted);font-size:11px">' + esc(meta.disk_path) + '</div>';
  html += '</div>';
  container.innerHTML = html;
});

// path.namespace — show namespace info
AppUINodeRenderers.register('path.namespace', function(container, node, ctx) {
  var esc = ctx.esc || function(s) { return String(s||''); };
  var meta = node.metadata || {};
  var html = '<div style="font-size:12px">';
  html += '<div style="font-weight:bold;color:var(--color-error, #ff5370);margin-bottom:4px">📦 ' + esc(node.key || '') + '</div>';
  if (meta.location) html += '<div><span style="color:var(--text-muted)">Location:</span> ' + esc(meta.location) + '</div>';
  if (meta.root) html += '<div style="color:var(--text-muted);font-size:11px;word-break:break-all">' + esc(meta.root) + '</div>';
  html += '</div>';
  container.innerHTML = html;
});

// * (fallback) — generic node info
AppUINodeRenderers.register('*', function(container, node, ctx) {
  var esc = ctx.esc || function(s) { return String(s||''); };
  var html = '<div style="font-size:12px">';
  html += '<div style="color:var(--text-muted)">[' + esc(node.type || '?') + '] ' + esc(node.key || node.description || '') + '</div>';
  if (node.description && node.key !== node.description) html += '<div style="color:var(--text-muted);margin-top:4px">' + esc(node.description) + '</div>';
  html += '</div>';
  container.innerHTML = html;
});
