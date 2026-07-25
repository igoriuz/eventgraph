(function() {
  const data = window.__EVENTGRAPH_DATA__;
  if (!data) return;

  const activeContexts = new Set(data.contexts);
  const detailPanel = document.getElementById('detail-panel');

  // Adjacency, so focusing a node can hide everything unrelated to it. A
  // whole-graph view stops being readable within a few dozen nodes; the point
  // of holding this as a graph is being able to ask for a part of it.
  const neighbours = new Map();
  const link = (a, b) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set([a]));
    neighbours.get(a).add(b);
  };
  data.edges.forEach(e => { link(e.from, e.to); link(e.to, e.from); });

  let focused = null;

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
      focused = focused === nodeId ? null : nodeId;
      showDetail(node);
      updateVisibility();
    });
  });

  function inFocus(id) {
    if (!focused) return true;
    const near = neighbours.get(focused);
    return id === focused || (near && near.has(id));
  }

  function updateVisibility() {
    document.querySelectorAll('.node').forEach(el => {
      const visible = activeContexts.has(el.dataset.context);
      el.style.display = visible ? '' : 'none';
      el.classList.toggle('dimmed', visible && !inFocus(el.dataset.id));
      el.classList.toggle('focused', el.dataset.id === focused);
    });
    document.querySelectorAll('.edge-line').forEach(el => {
      const visible = activeContexts.has(el.dataset.fromContext) && activeContexts.has(el.dataset.toContext);
      el.style.display = visible ? '' : 'none';
      const related = !focused || el.dataset.from === focused || el.dataset.to === focused;
      el.classList.toggle('dimmed', visible && !related);
    });
    const hint = document.getElementById('focus-hint');
    if (hint) hint.textContent = focused ? 'Focused — click the node again to show everything' : '';
  }

  // Escape clears the focus without hunting for the node again.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && focused) {
      focused = null;
      updateVisibility();
    }
  });

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
