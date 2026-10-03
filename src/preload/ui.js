// Puente seguro entre la barra de pestañas y el proceso principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('murcord', {
  getState: () => ipcRenderer.invoke('get-state'),
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
  activate: (id) => ipcRenderer.send('tab:activate', id),
  close: (id) => ipcRenderer.send('tab:close', id),
  rename: (id, name) => ipcRenderer.send('tab:rename', id, name),
  newTab: () => ipcRenderer.send('tab:new'),
});
