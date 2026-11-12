import { requestLocalScopeGroups } from './local-scope-ai.mjs';

// Same-origin, loopback-only proxy. No browser-controlled upstream URL, key or payment capability.
export async function handleLocalSuggestions(req, res, { model = '', fetchImpl = fetch, port = 11434 } = {}) {
  const reply = (status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST') return reply(405, { error: 'Use POST to request a local suggestion.' });
  // A hostile web page can issue simple cross-origin POSTs to localhost.
  // Reject those before they consume local model resources.
  const origin = req.headers?.origin;
  if (typeof origin === 'string') {
    let sameOrigin = false;
    try {
      const parsed = new URL(origin);
      sameOrigin = parsed.protocol === 'http:' && parsed.host === req.headers.host;
    } catch {}
    if (!sameOrigin) return reply(403, { error: 'Local AI accepts requests from this application only.' });
  }
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] ?? '')) {
    return reply(415, { error: 'Local AI requests must use JSON.' });
  }
  if (!model) return reply(503, { error: 'Local AI is not configured. Choose a model in Studio.' });
  const disconnected = new AbortController();
  const cancelOnClose = () => { if (!res.writableEnded) disconnected.abort(); };
  res.on('close', cancelOnClose);
  let size = 0;
  const chunks = [];
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384) return reply(413, { error: 'The request is too large.' });
      chunks.push(chunk);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).some(key => !['brief', 'wait'].includes(key))
      || typeof payload.brief !== 'string'
      || (payload.wait !== undefined && payload.wait !== 'extended')) {
      return reply(400, { error: 'Only a creative brief and the optional extended wait choice are accepted.' });
    }
    if (!payload.brief.trim() || payload.brief.length > 8000) {
      return reply(400, { error: 'Enter a creative brief of 1–8000 characters.' });
    }
    const suggestions = await requestLocalScopeGroups(payload.brief, {
      model, fetchImpl, port, signal: AbortSignal.any([disconnected.signal, AbortSignal.timeout(payload.wait === 'extended' ? 90000 : 60000)])
    });
    return reply(200, suggestions);
  } catch (error) {
    if (disconnected.signal.aborted) return;
    const message = error?.name === 'TimeoutError'
      ? 'The local model timed out. The draft was not changed.'
      : 'The local model could not produce valid checkpoints. The draft was not changed.';
    return reply(502, { error: message });
  } finally {
    res.off('close', cancelOnClose);
  }
}

export function localModelSelection(workspace, config) {
  return workspace.localModel ?? { model: config.localAiModel || '', port: config.localAiPort || 11434 };
}

function modelError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function validateModelPort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw modelError(400, 'Enter a server port from 1 to 65535.');
  return port;
}

export async function listLocalModels({ port = 11434, fetchImpl = fetch } = {}) {
  validateModelPort(port);
  let response, body;
  try {
    response = await fetchImpl('http://127.0.0.1:' + port + '/api/tags', {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error('Model list unavailable');
    body = await response.json();
  } catch {
    throw modelError(502, 'Cannot reach Ollama on this computer. Open Ollama, then refresh the models.');
  }
  if (!Array.isArray(body?.models) || body.models.length > 1000)
    throw modelError(502, 'Ollama did not return a readable model list.');
  const names = new Set();
  for (const entry of body.models) {
    const name = entry?.name ?? entry?.model;
    if (typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(name)) names.add(name);
  }
  return Array.from(names).sort();
}
