// App/capability dependency nodes, edges and reverse references.
export function buildDependencyGraph(apps) {
  const nodes = []; const edges = []; const byId = {};
  const addNode = (id, type, extra) => { if (!byId[id]) { byId[id] = Object.assign({ id, type, deps: [], rdeps: [] }, extra || {}); nodes.push(byId[id]); } return byId[id]; };
  for (const a of apps) addNode(a.app_id, 'app', { title: a.title || a.app_id, present: true });
  for (const a of apps) {
    for (const d of (a.needs_apps || [])) {
      if (!d || !d.id) continue;
      addNode(d.id, 'app', { title: d.id, present: d.present !== false });
      edges.push({ from: a.app_id, to: d.id, kind: 'app', present: d.present !== false });
      byId[a.app_id].deps.push(d.id); byId[d.id] && byId[d.id].rdeps.push(a.app_id);
    }
    for (const c of (a.needs_capabilities || [])) {
      const cid = (c && (c.name || c)) ? ('cap:' + String((c.name || c)).replace(/^cap:/, '')) : null;
      if (!cid) continue;
      addNode(cid, 'cap', { title: cid.replace(/^cap:/, ''), optional: !!(c && c.optional) });
      edges.push({ from: a.app_id, to: cid, kind: 'cap', optional: !!(c && c.optional) });
      byId[a.app_id].deps.push(cid); byId[cid].rdeps.push(a.app_id);
    }
  }
  // usage count for caps (how many apps need each)
  for (const nd of nodes) if (nd.type === 'cap') nd.usage = nd.rdeps.length;
  return { nodes, edges, byId };
}

