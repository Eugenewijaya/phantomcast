import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('phantomBridge', {
  sendPipelineState: (payload: unknown) => {
    ipcRenderer.send('SET_PIPELINE_STATE', payload);
  },
  sendVoiceDsp: (payload: unknown) => {
    ipcRenderer.send('SET_VOICE_DSP', payload);
  },
  getSidecarStatus: () => ipcRenderer.invoke('GET_SIDECAR_STATUS'),
  restartSidecar: () => ipcRenderer.invoke('RESTART_SIDECAR'),
});
