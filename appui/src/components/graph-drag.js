/** D3 node dragging. The caller supplies D3, its selection, and simulation. */
const AppUIGraphDrag = (function() {
  'use strict';
  function bind({d3, selection, getSimulation, isCurrent = () => true, filter}) {
    let destroyed = false;
    const active = new Map();
    const current = () => !destroyed && isCurrent();
    const behavior = d3.drag()
      .on('start', (event, node) => {
        if (!current()) return;
        const simulation = getSimulation();
        active.set(node, simulation);
        if (!event.active) simulation.alphaTarget(0.3).restart();
        node.fx = node.x; node.fy = node.y;
      })
      .on('drag', (event, node) => {
        if (!current() || !active.has(node)) return;
        node.fx = event.x; node.fy = event.y;
      })
      .on('end', (event, node) => {
        if (!active.has(node)) return;
        const simulation = active.get(node);
        active.delete(node);
        if (!event.active) simulation.alphaTarget(0);
        node.fx = null; node.fy = null;
      });
    if (filter) behavior.filter(event => current() && filter(event));
    selection.call(behavior);
    return {
      isDragging() {return active.size > 0;},
      destroy() {
        if (destroyed) return;
        destroyed = true;
        selection.on('.drag', null);
        const simulations = new Set(active.values());
        for (const node of active.keys()) {node.fx = null; node.fy = null;}
        active.clear();
        for (const simulation of simulations) simulation.alphaTarget(0);
      },
    };
  }
  return {bind};
})();
window.AppUIGraphDrag = AppUIGraphDrag;
