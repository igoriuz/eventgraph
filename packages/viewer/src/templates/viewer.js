(function() {
  const data = window.__EVENTGRAPH_DATA__;
  if (!data) return;

  const activeContexts = new Set(data.contexts);
  const detailPanel = document.getElementById('detail-panel');

  document.querySelectorAll('.context-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      const ctx = btn.dataset.context;
      if (ctx === '__all__') {
        data.contexts.forEach(c => activeContexts.add(c));
      } else if (activeContexts.has(ctx)) {
        activeContexts.delete(ctx);
      } else {
        activeContexts.add(ctx);
      }
      updateVisibility();
      updateFilterButtons();
    });
  });

  document.querySelectorAll('.node').forEach(el => {
    el.addEventListener('click', () => {
      const nodeId = el.dataset.id;
      const node = data.nodes.find(n => n.id === nodeId);
      if (!node) return;
      showDetail(node);
    });
  });

  function updateVisibility() {
    document.querySelectorAll('.node').forEach(el => {
      const ctx = el.dataset.context;
      el.style.display = activeContexts.has(ctx) ? '' : 'none';
    });
    document.querySelectorAll('.edge-line').forEach(el => {
      const fromCtx = el.dataset.fromContext;
      const toCtx = el.dataset.toContext;
      el.style.display = (activeContexts.has(fromCtx) && activeContexts.has(toCtx)) ? '' : 'none';
    });
  }

  function updateFilterButtons() {
    document.querySelectorAll('.context-filter').forEach(btn => {
      const ctx = btn.dataset.context;
      if (ctx === '__all__') {
        btn.className = 'pill ' + (activeContexts.size === data.contexts.length ? 'active' : 'inactive');
      } else {
        btn.className = 'pill ' + (activeContexts.has(ctx) ? 'active' : 'inactive');
      }
    });
  }

  function showDetail(node) {
    detailPanel.className = 'detail-panel visible';
    detailPanel.innerHTML = `
      <span class="detail-type" data-type="${node.type}">${node.type.toUpperCase()}</span>
      <span class="detail-name">${node.label}</span>
      <span class="detail-id">${node.id}</span>
      <span class="detail-info">${node.data ? 'fields: ' + (node.data.fields || []).join(', ') : ''}</span>
    `;
  }
})();
