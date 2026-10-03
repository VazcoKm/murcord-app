// Murcord — preload de cada pestaña: inyecta Equicord en Discord.
const { ipcRenderer, webFrame, contextBridge } = require('electron');

// Esta función se ejecuta dentro de la página (mundo principal) y simula las
// funciones GM_* que el userscript de Equicord espera de Tampermonkey.
function installGMShim() {
  const w = window;
  const PREFIX = 'murcord_gm_';

  w.unsafeWindow = w;
  w.GM_info = { scriptHandler: 'Murcord', version: '0.1.0', script: { name: 'Equicord', version: '0.1.0' } };

  w.GM_getValue = (key, def) => {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? def : JSON.parse(raw);
    } catch (_) { return def; }
  };
  w.GM_setValue = (key, value) => {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (_) { /* nada */ }
  };
  w.GM_deleteValue = (key) => {
    try { localStorage.removeItem(PREFIX + key); } catch (_) { /* nada */ }
  };
  w.GM_listValues = () => {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
      }
    } catch (_) { /* nada */ }
    return out;
  };
  w.GM_addStyle = (css) => {
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).append(style);
    return style;
  };

  w.GM_xmlhttpRequest = (details) => {
    const type = details.responseType || '';
    w.__murcordBridge
      .request({ url: details.url, method: details.method, headers: details.headers, data: details.data })
      .then((res) => {
        const text = new TextDecoder().decode(res.buffer);
        let response = text;
        if (type === 'arraybuffer') response = res.buffer;
        else if (type === 'blob') response = new Blob([res.buffer]);
        else if (type === 'json') { try { response = JSON.parse(text); } catch (_) { response = null; } }
        const out = {
          status: res.status,
          statusText: res.statusText,
          finalUrl: res.finalUrl,
          responseHeaders: res.headers,
          response,
          responseText: text,
          readyState: 4,
          context: details.context,
        };
        if (details.onload) details.onload(out);
        if (details.onloadend) details.onloadend(out);
      })
      .catch((err) => {
        const out = { error: String(err), status: 0, readyState: 4, context: details.context };
        if (details.onerror) details.onerror(out);
        if (details.onloadend) details.onloadend(out);
      });
    return { abort() { /* no soportado todavía */ } };
  };

  w.GM = {
    xmlHttpRequest: w.GM_xmlhttpRequest,
    getValue: async (k, d) => w.GM_getValue(k, d),
    setValue: async (k, v) => w.GM_setValue(k, v),
  };
}

const host = location.hostname;
if (host === 'discord.com' || host.endsWith('.discord.com')) {
  const bundle = ipcRenderer.sendSync('murcord:get-equicord');

  if (bundle && bundle.js) {
    // Puente de red (lo atiende el proceso principal).
    contextBridge.exposeInMainWorld('__murcordBridge', {
      request: (details) => ipcRenderer.invoke('murcord:gm-request', details),
    });

    // Se ejecuta antes que el código de Discord, igual que hace Equicord en el escritorio.
    webFrame.executeJavaScript(`(${installGMShim.toString()})();\n${bundle.js}`);

    if (bundle.css) {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.id = 'murcord-equicord-css';
        style.textContent = bundle.css;
        document.documentElement.append(style);
      }, { once: true });
    }
  }
}
