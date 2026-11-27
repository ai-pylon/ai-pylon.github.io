/* Pipeline loading is cancellable infrastructure, not shell rendering. */
window.AppUIShellPipelineLoader = {
  load(pipelineId, {isCurrent, onPipeline}) {
    if (!pipelineId) return null;
    const controller = new AbortController();
    fetch('/api/pipeline.get', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: pipelineId}), signal: controller.signal,
    }).then(response => response.json()).then(data => {
      if (!isCurrent()) return;
      // API errors can be JSON responses; only accept actual pipeline data.
      onPipeline(data?.menu ? data : null);
    }).catch(() => {});
    return controller;
  },
};
