const { contextBridge, ipcRenderer } = require('electron');

// O segredo de ativação vem do processo principal (lê apps/lite/.env.local),
// não do bundle. Só este valor e dados da plataforma são expostos.
let activationSecret = '';
try { activationSecret = ipcRenderer.sendSync('mch:activation-secret') || ''; } catch { /* sem segredo */ }

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.versions.electron,
  activationSecret,
});
