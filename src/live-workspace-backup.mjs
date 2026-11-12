const button = document.getElementById('download-workspace-backup');
const notice = document.getElementById('workspace-backup-notice');
button?.addEventListener('click', async () => {
  button.disabled = true;
  notice.textContent = 'Preparing committed workspace records…';
  try {
    const session = await fetch('/api/state?project=new', {cache:'no-store'});
    if (!session.ok) throw new Error('Could not read the local workspace.');
    const {token} = await session.json();
    const response = await fetch('/api/workspace-backup', {
      method:'POST', headers:{'content-type':'application/json','x-scopesignal-token':token},
      body:'{}'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Backup could not be prepared.');
    const blob = new Blob([JSON.stringify(data.workspace, null, 2)+'\n'], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ScopeSignal-workspace-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    notice.textContent = 'Workspace records downloaded. Keep delivery files and unsent drafts separately.';
  } catch (error) {
    notice.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});


const restore = document.getElementById('restore-workspace');
const fileInput = document.getElementById('workspace-backup-file');
const restoreButton = document.getElementById('restore-workspace-records');
const restoreNotice = document.getElementById('workspace-restore-notice');
let selectedBackup = null;
async function readWorkspace() {
  const response = await fetch('/api/state?project=new', {cache:'no-store'});
  if (!response.ok) throw new Error('Could not read the local workspace.');
  return response.json();
}
if (restore) {
  readWorkspace().then(({state}) => { restore.hidden = state.projects.length !== 0; }).catch(() => {});
  fileInput.addEventListener('change', async () => {
    selectedBackup = null; restoreButton.disabled = true;
    const file = fileInput.files[0];
    if (!file) { restoreNotice.textContent = ''; return; }
    try {
      const workspace = JSON.parse(await file.text());
      if (workspace?.version !== 2 || !Array.isArray(workspace.projects) || !workspace.projects.length)
        throw new Error('Choose a workspace records backup containing saved projects.');
      selectedBackup = workspace;
      restoreNotice.textContent = workspace.projects.length + ' saved project' + (workspace.projects.length === 1 ? '' : 's') + ' ready to restore. Existing records will never be replaced.';
      restoreButton.disabled = false;
    } catch (error) { restoreNotice.textContent = error instanceof SyntaxError ? 'This file is not a readable JSON backup.' : error.message; }
  });
  restoreButton.addEventListener('click', async () => {
    if (!selectedBackup) return;
    restoreButton.disabled = true; fileInput.disabled = true;
    restoreNotice.textContent = 'Restoring saved workspace records…';
    try {
      const {token} = await readWorkspace();
      const response = await fetch('/api/workspace-restore', {
        method:'POST', headers:{'content-type':'application/json','x-scopesignal-token':token},
        body:JSON.stringify({workspace:selectedBackup})
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Workspace records could not be restored.');
      location.href = './live.html?project=' + encodeURIComponent(result.projectId);
    } catch (error) {
      restoreNotice.textContent = error.message + ' Your selected backup file is unchanged.';
      restoreButton.disabled = false; fileInput.disabled = false;
    }
  });
}
