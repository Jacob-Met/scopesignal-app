export function mountLocalModelConnection(root, { getToken, getState, onSelected, refresh }) {
  const find = id => root.querySelector('#' + id);
  const heading = find('model-connection-heading'), status = find('model-connection-status');
  const select = find('local-model-choice'), port = find('local-model-port');
  const use = find('use-local-model'), scan = find('refresh-local-models'), disconnect = find('disconnect-local-model');
  const current = document.getElementById('choose-model');
  let request = null, saving = false, locked = false, listedPort = null;
  const say = message => { status.textContent = message; };
  const numericPort = () => {
    if (!/^[0-9]{1,5}$/.test(port.value) || Number(port.value) < 1 || Number(port.value) > 65535)
      throw new Error('Enter a server port from 1 to 65535.');
    return Number(port.value);
  };
  function controls() {
    const waiting = saving || Boolean(request) || locked;
    use.disabled = waiting || !select.value || Number(port.value) !== listedPort;
    scan.disabled = waiting;
    select.disabled = waiting || !listedPort;
    port.disabled = saving;
    disconnect.disabled = waiting;
    disconnect.hidden = !getState()?.configured.localAi;
    current.disabled = waiting;
  }
  async function post(path, body, signal) {
    const response = await fetch(path, {
      method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-scopesignal-token': getToken() },
      body: JSON.stringify(body), signal
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The model connection could not be changed.');
    return result;
  }
  async function scanModels() {
    request?.abort();
    let chosenPort;
    try { chosenPort = numericPort(); } catch (error) { say(error.message); port.focus(); return; }
    const controller = new AbortController(); request = controller; listedPort = null;
    select.replaceChildren(new Option('Choose a model', ''));
    say('Finding models…'); controls();
    try {
      const result = await post('/api/local-models', { port: chosenPort }, controller.signal);
      if (request !== controller || root.hidden) return;
      listedPort = chosenPort;
      for (const name of result.models) select.append(new Option(name, name));
      const previous = getState()?.localModel;
      if (previous?.port === chosenPort && result.models.includes(previous.model)) select.value = previous.model;
      say(result.models.length ? '' : 'No models are installed yet. Add a model in Ollama, then refresh.');
    } catch (error) {
      if (!controller.signal.aborted) say(error.message || 'Models could not be read. Try refreshing.');
    } finally {
      if (request === controller) request = null;
      controls();
    }
  }
  function close() {
    if (saving) return;
    request?.abort(); request = null; root.hidden = true; controls();
    document.getElementById('suggest').focus({ preventScroll: true });
  }
  async function choose(model) {
    let chosenPort;
    try { chosenPort = numericPort(); } catch (error) { say(error.message); port.focus(); return; }
    saving = true; say(model ? 'Selecting model…' : 'Disconnecting local model…'); controls();
    try {
      const result = await post('/api/local-model', { model, port: chosenPort });
      onSelected(result);
      saving = false; close();
    } catch (error) {
      const observed = await refresh();
      const selection = getState()?.localModel;
      if (observed && selection?.model === model && selection.port === chosenPort) {
        saving = false; close();
      } else say(error.message || 'The model choice could not be saved. Your brief is still here.');
    } finally { saving = false; controls(); }
  }
  find('close-model-connection').onclick = close;
  scan.onclick = scanModels;
  use.onclick = () => choose(select.value);
  disconnect.onclick = () => choose('');
  select.onchange = controls;
  port.oninput = () => {
    request?.abort(); request = null; listedPort = null; controls();
    say('Refresh the models for this port.');
  };
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  });
  return {
    async open() {
      if (locked) return;
      root.hidden = false;
      port.value = String(getState()?.localModel?.port || 11434);
      heading.focus({ preventScroll: true }); root.scrollIntoView({ block: 'nearest' });
      await scanModels();
      if (!root.hidden && root.contains(document.activeElement)) root.scrollIntoView({ block: 'nearest' });
    },
    update(state, disabled) {
      locked = disabled;
      current.hidden = !(state?.configured.localAi || state?.configured.ai);
      current.textContent = state?.configured.localAi ? (state.localModel?.model || 'Change model') : 'Cloud AI · change';
      current.title = 'Choose the model used for suggestions';
      controls();
    }
  };
}
