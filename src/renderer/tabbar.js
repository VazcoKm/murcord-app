const tabsEl = document.getElementById('tabs');
const countEl = document.getElementById('count');
const addBtn = document.getElementById('add');

const els = new Map(); // id de pestaña -> elemento (se reutilizan para no perder el doble clic)
let lastState = null;
let editingId = null;

function buildTab(t) {
  const el = document.createElement('div');
  el.dataset.id = t.id;
  el.className = 'tab' + (t.main ? ' main' : '');
  el.addEventListener('click', () => window.murcord.activate(el.dataset.id));
  el.addEventListener('dblclick', () => startRename(el.dataset.id));
  el.addEventListener('auxclick', (ev) => {
    if (ev.button === 1 && t.closable) window.murcord.close(el.dataset.id); // clic central cierra
  });

  const label = document.createElement('span');
  label.className = 'label';
  el.append(label);

  if (t.closable) {
    const x = document.createElement('button');
    x.className = 'close';
    x.textContent = '×';
    x.title = 'Cerrar pestaña (la sesión se conserva)';
    x.addEventListener('click', (ev) => {
      ev.stopPropagation();
      window.murcord.close(el.dataset.id);
    });
    el.append(x);
  }
  return el;
}

function render(state) {
  if (!state) return;
  lastState = state;
  const seen = new Set();

  state.tabs.forEach((t, i) => {
    let el = els.get(t.id);
    if (!el) {
      el = buildTab(t);
      els.set(t.id, el);
    }
    seen.add(t.id);

    el.classList.toggle('active', t.id === state.activeTabId);
    el.title = (t.title || t.label) + '\nDoble clic para renombrar';
    if (editingId !== t.id) {
      el.querySelector('.label').textContent = (t.main ? '★ ' : '') + t.label;
    }
    // Solo se mueve si no está ya en su sitio.
    if (tabsEl.children[i] !== el) tabsEl.insertBefore(el, tabsEl.children[i] || null);
  });

  for (const [id, el] of els) {
    if (!seen.has(id)) { el.remove(); els.delete(id); }
  }

  countEl.textContent = `${state.tabs.length}/${state.max}`;
  countEl.classList.toggle('full', state.tabs.length >= state.max);
}

function startRename(id) {
  const el = els.get(id);
  const tab = lastState && lastState.tabs.find((t) => t.id === id);
  if (!el || !tab || editingId) return;

  editingId = id;
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = tab.label;
  input.maxLength = 24;
  el.querySelector('.label').replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    editingId = null;
    const value = input.value.trim();
    const span = document.createElement('span');
    span.className = 'label';
    input.replaceWith(span);
    if (save && value && value !== tab.label) window.murcord.rename(id, value);
    render(lastState);
  };

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') finish(true);
    else if (ev.key === 'Escape') finish(false);
    ev.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (ev) => ev.stopPropagation());
  input.addEventListener('dblclick', (ev) => ev.stopPropagation());
}

addBtn.addEventListener('click', () => window.murcord.newTab());
window.murcord.onState(render);
window.murcord.getState().then(render);
