'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('host', {
  getConfig: () => ipcRenderer.invoke('config'),
  onMessage: (cb) => ipcRenderer.on('msg', (_e, m) => cb(m)),
  send: (m) => ipcRenderer.send('msg', m),
  resizeTo: (w) => ipcRenderer.send('resize-to', w),
});
