/* Built-in node presentations registered with the shared runtime registry. */
// code.function — show signature, params, line range
AppUINodeRenderers.register('code.function', function(container, node, ctx) {
  var esc = ctx.esc || function(s) { return String(s||'').replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  var meta = node.metadata || {};
  var html = '<div style="font-size:12px">';
  html += '<div style="font-weight:bold;color:var(--accent);margin-bottom:4px">' + esc(node.key || '') + '</div>';
  if (node.description) html += '<div style="color:var(--text-muted);margin-bottom:6px">' + esc(node.description) + '</div>';
  if (meta.params && meta.params.length) html += '<div><span style="color:var(--text-muted)">Params:</span> <code>' + esc(meta.params.join(', ')) + '</code></div>';
  if (meta.return_type) html += '<div><span style="color:var(--text-muted)">Returns:</span> <code>' + esc(meta.return_type) + '</code></div>';
  if (meta.start_line) html += '<div><span style="color:var(--text-muted)">Lines:</span> ' + meta.start_line + (meta.end_line ? '-' + meta.end_line : '') + '</div>';
  if (meta.decorators && meta.decorators.length) html += '<div><span style="color:var(--text-muted)">Decorators:</span> ' + esc(meta.decorators.join(', ')) + '</div>';
  html += '</div>';
  container.innerHTML = html;
});

// code.class — show class name, bases, methods count
AppUINodeRenderers.register('code.class', function(container, node, ctx) {
  var esc = ctx.esc || function(s) { return String(s||''); };
  var meta = node.metadata || {};
  var html = '<div style="font-size:12px">';
  html += '<div style="font-weight:bold;color:var(--color-info, #c792ea);margin-bottom:4px">class ' + esc(node.key || '') + '</div>';
  if (node.description) html += '<div style="color:var(--text-muted);margin-bottom:6px">' + esc(node.description) + '</div>';
  if (meta.bases && meta.bases.length) html += '<div><span style="color:var(--text-muted)">Bases:</span> ' + esc(meta.bases.join(', ')) + '</div>';
  if (meta.start_line) html += '<div><span style="color:var(--text-muted)">Lines:</span> ' + meta.start_line + (meta.end_line ? '-' + meta.end_line : '') + '</div>';
  html += '</div>';
  container.innerHTML = html;
});

// kind:tool — show tool metadata
AppUINodeRenderers.register('kind:tool', function(container, node, ctx) {
  var esc = ctx.esc || function(s) { return String(s||''); };
  var meta = node.metadata || {};
  var html = '<div style="font-size:12px">';
  html += '<div style="font-weight:bold;color:var(--color-warning, #ffcb6b);margin-bottom:4px">⚙ ' + esc(node.key || '') + '</div>';
  if (node.description) html += '<div style="color:var(--text-muted);margin-bottom:6px">' + esc(node.description) + '</div>';
  html += '<table style="font-size:11px;width:100%">';
  if (meta.function) html += '<tr><td style="color:var(--text-muted);width:70px">Function</td><td><code>' + esc(meta.function) + '</code></td></tr>';
  if (meta.params && meta.params.length) html += '<tr><td style="color:var(--text-muted)">Params</td><td><code>' + esc(meta.params.join(', ')) + '</code></td></tr>';
  if (meta.requires && meta.requires.length) html += '<tr><td style="color:var(--text-muted)">Requires</td><td>' + esc(meta.requires.join(', ')) + '</td></tr>';
  if (meta.source_file) html += '<tr><td style="color:var(--text-muted)">Source</td><td style="word-break:break-all">' + esc(meta.source_file) + '</td></tr>';
  if (meta.line) html += '<tr><td style="color:var(--text-muted)">Line</td><td>' + meta.line + '</td></tr>';
  html += '</table></div>';
  container.innerHTML = html;
});

