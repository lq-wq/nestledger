/* 测试用 fetch 垫片：仅在没有 WebAssembly 的运行环境里接管全局 fetch。
 * Node 内置的 undici fetch 依赖 WASM 解析 HTTP；部分沙箱 / 受限环境无法分配 WASM 内存，
 * 导致测试还没连上服务就抛 RangeError。这里用 node:http / node:https 实现测试所需的最小 Response。
 * 仅覆盖测试脚本用到的 status / ok / headers.get / text / json，不改变应用运行逻辑。
 */
import { createRequire } from 'node:module';
// 用 CJS require 加载 http/https：受限环境下 ESM 导入 node:http 会触发 undici 的 WASM 初始化
const require = createRequire(import.meta.url);
const http = require('node:http');
const https = require('node:https');

function wasmAvailable() {
  try { new WebAssembly.Memory({ initial: 1 }); return true; }
  catch (e) { return false; }
}

function makeHeaders(raw) {
  const h = {};
  Object.keys(raw || {}).forEach(function (k) {
    const v = raw[k];
    h[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  });
  return {
    get(name) { return h[String(name || '').toLowerCase()] || null; },
    has(name) { return Object.prototype.hasOwnProperty.call(h, String(name || '').toLowerCase()); },
    raw() { return raw || {}; }
  };
}

function makeResponse(status, headers, buf) {
  const text = () => Promise.resolve(buf.toString('utf8'));
  return {
    status: Number(status) || 0,
    ok: Number(status) >= 200 && Number(status) < 300,
    headers: makeHeaders(headers),
    text,
    json() { return text().then(s => JSON.parse(s)); },
    arrayBuffer() { return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)); }
  };
}

export function installFetchShim() {
  // 先判断 WASM，再决定是否读取 / 覆盖 globalThis.fetch：
  // Node 的全局 fetch 是惰性 getter，读取它会立刻加载 undici 并实例化 WASM 解析器。
  if (wasmAvailable()) return false;
  globalThis.fetch = function (url, opt) {
    opt = opt || {};
    return new Promise(function (resolve, reject) {
      let u;
      try { u = new URL(String(url), 'http://127.0.0.1'); }
      catch (e) { return reject(e); }
      const lib = u.protocol === 'https:' ? https : http;
      const headers = {};
      const src = opt.headers || {};
      if (typeof src.forEach === 'function' && typeof src.set === 'function') {
        src.forEach(function (v, k) { headers[k] = v; });
      } else {
        Object.keys(src).forEach(function (k) { headers[k] = src[k]; });
      }
      const method = String(opt.method || 'GET').toUpperCase();
      const req = lib.request(u, { method, headers }, function (res) {
        const chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () { resolve(makeResponse(res.statusCode, res.headers, Buffer.concat(chunks))); });
      });
      req.on('error', reject);
      if (opt.body != null && method !== 'GET' && method !== 'HEAD') {
        req.write(typeof opt.body === 'string' ? opt.body : JSON.stringify(opt.body));
      }
      req.end();
    });
  };
  return true;
}
