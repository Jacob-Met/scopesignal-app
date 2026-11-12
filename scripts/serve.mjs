import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { handleLocalSuggestions } from '../src/local-scope-ai-server.mjs';
const root = process.cwd();
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/api/local-suggestions') return await handleLocalSuggestions(req, res, { model: process.env.SCOPESIGNAL_OLLAMA_MODEL, port: Number(process.env.SCOPESIGNAL_OLLAMA_PORT || 11434) });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
    const safe = normalize(pathname).replace(/^([.][.][/\\])+/, '').replace(/^[/\\]+/, '');
    const path = join(root, safe || 'index.html');
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`ScopeSignal at http://127.0.0.1:${process.env.PORT || 4173}`));
