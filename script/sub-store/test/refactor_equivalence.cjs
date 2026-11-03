// 当前 1.14 模板和个人参数以精简前的实现作对照，检查输出和外部行为。
// 基线不能随生产脚本更新；行为修复应另行说明并增加独立测试。
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { isDeepStrictEqual } = require('node:util');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
const template = JSON.parse(read('source/sing_config_template_1.14.json'));
const baseline = read('script/sub-store/test/fixtures/sub_store_sb_convert.before_refactor.js');
const candidates = ['sub_store_sb_convert.js', 'sub_store_sb_convert_1.14.js'].map((file) => ({
  file, source: read(`script/sub-store/${file}`),
}));
const node = { type: 'http', tag: 'TEST-Hong Kong', server: '192.0.2.10', server_port: 8080 };
const personal = { ...node, tag: '私人节点', server: '192.0.2.20' };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64');
const scenarios = [];
const add = (name, options = {}) => scenarios.push({ name, ...options });
function changedTemplate(change) {
  const value = clone(template);
  change(value);
  return value;
}

add('default');
add('node-file-before-template', { content: [personal], files: [template] });
add('duplicate-input-files', { files: [[personal], [personal]] });
add('files-only', { omitContent: true, files: [[personal], template] });
add('empty-input', { content: '', files: [] });
add('invalid-primary-with-valid-template', { content: '{invalid', files: [template, [personal]] });
add('invalid-slice', { files: ['{invalid', null, 1, [personal]] });
add('node-array-without-template', { content: [personal] });
add('fallback-template-without-inbounds', { content: changedTemplate((value) => { delete value.inbounds; }) });
add('no-subscription', { args: { name: undefined }, files: [[personal]] });
add('subscription-error', { artifactError: true });
add('non-array-artifact', { artifactResult: { unsupported: 'shape' } });
for (const version of ['1.14', '1.14.4', 'v1.14.4', '1.14.4-beta.1', '1.14.4+build', '1.13', '1.15', 'invalid']) {
  add(`version-${version}`, { args: { v: version } });
}
add('version-alias', { args: { version: '1.14.4' } });
for (const type of ['1', 1, 'col', 'collection', '组合', 'subscription', 'mycollection']) {
  add(`subscription-type-${type}`, { args: { type } });
}
for (const value of [true, false, 'true', 'false', 1]) {
  add(`unsupported-proxy-${value}`, { args: { includeUnsupportedProxy: value } });
}
add('remote-subscription', { args: { name: undefined, url: 'https://example.invalid/subscription' } });

for (const key of ['selfSub', 'selfNodes', 'selfCollection', 'customSub']) {
  add(`self-subscription-${key}`, { args: { [key]: 'personal-sub' } });
}
for (const type of ['collection', '组合', 'subscription']) {
  add(`self-subscription-type-${type}`, { args: { selfSub: 'personal-sub', selfSubType: type } });
}
add('self-subscription-error', { args: { selfSub: 'personal-sub' }, selfError: true });
add('self-subscription-non-array', { args: { selfSub: 'personal-sub' }, selfResult: personal });
for (const [name, value] of [['array', [personal]], ['single', personal], ['wrapped', { outbounds: [personal] }], ['invalid', null]]) {
  add(`encoded-nodes-${name}`, { args: { customNodes: value === null ? 'invalid-base64' : encode(value) } });
}
add('encoded-node-alias', { args: { customNode: encode(personal) } });
add('encoded-nodes-without-padding', { args: { customNodes: encode([personal]).replace(/=+$/, '') } });
add('encoded-nodes-url-safe', { args: { customNodes: encode([personal]).replace(/\+/g, '-').replace(/\//g, '_') } });
for (const key of ['custom', 'customConfig', 'customSettings']) {
  add(`custom-bundle-${key}`, { args: { [key]: encode({ nodes: [personal], interfaceName: 'private-tun' }) } });
}
add('custom-bundle-single-node', { args: { custom: encode({ node: personal }) } });
add('custom-bundle-invalid', { args: { custom: 'invalid-base64' } });
add('custom-bundle-self-subscription', { args: { custom: encode({ selfSub: 'personal-sub' }) } });
for (const value of [false, 'false', 'none']) {
  add(`disabled-self-${value}`, { args: { customNodes: value, selfSub: 'personal-sub' }, files: [[personal]] });
}
add('disabled-nodes-takes-precedence', { args: { nodes: false, customNodes: encode([personal]) }, files: [[personal]] });
add('node-object-file', { files: [{ outbounds: [personal] }] });
add('nodes-property-file', { files: [{ nodes: [personal] }] });
add('custom-node-array-retains-original-shape', { args: { custom: encode({ node: [personal] }) } });
add('empty-custom-nodes-retains-precedence', { args: { custom: encode({ nodes: [], node: personal }) } });
add('duplicate-node-tags', { artifactResult: [node, node], files: [[personal, personal]] });
add('same-airport-and-self-tag', { files: [[{ ...personal, tag: node.tag }]] });
add('template-node-tag-collision', { files: [[{ ...personal, tag: 'direct-out' }]] });
add('invalid-node-entries', { files: [[null, 'invalid', {}, personal]] });

for (const key of ['localFile', 'localFiles', 'customFile', 'customFiles']) {
  add(`named-file-${key}`, { args: { [key]: 'private-file' }, storeMode: 'read' });
}
add('named-file-prefixed-key', { args: { localFile: 'private-file' }, storeMode: 'prefix' });
add('named-file-getFile', { args: { localFile: 'private-file' }, storeMode: 'getFile' });
add('named-file-read-throws', { args: { localFile: 'private-file' }, storeMode: 'throw', http: 'utils' });
add('named-file-invalid-json', { args: { localFile: 'private-file' }, storeMode: 'invalid' });
add('named-file-multiple', { args: { localFiles: 'one,two;three' }, storeMode: 'read' });
add('named-file-custom-bundle', { args: { custom: encode({ localFiles: ['one', 'two'] }) }, storeMode: 'read' });
for (const [name, payload] of [['single', personal], ['outbounds', { outbounds: [personal] }], ['nodes', { nodes: [personal] }]]) {
  add(`named-file-shape-${name}`, { args: { localFile: 'private-file' }, storeMode: 'read', payload });
  add(`remote-file-shape-${name}`, { args: { customNodesUrl: 'https://example.invalid/nodes' }, http: 'utils', payload });
}
for (const mode of ['callback', 'utils', 'fetch']) {
  for (const success of [0, 1, 2, 3, -1]) {
    add(`local-http-${mode}-${success}`, { args: { localFile: 'private-file' }, http: mode, localSuccess: success });
  }
  add(`remote-http-${mode}`, { args: { customNodesUrl: 'https://example.invalid/nodes' }, http: mode });
  add(`remote-http-error-${mode}`, { args: { customNodesUrl: 'https://example.invalid/nodes' }, http: mode, httpError: true });
  add(`remote-http-500-${mode}`, { args: { customNodesUrl: 'https://example.invalid/nodes' }, http: mode, httpStatus: 500 });
}
add('local-no-http-client', { args: { localFile: 'private-file' } });
add('callback-client-precedence', { args: { customNodeUrl: 'https://example.invalid/nodes' }, http: 'both' });
add('callback-timeout', { args: { customNodesUrl: 'https://example.invalid/nodes' }, http: 'callback', hang: true });
add('fetch-abort', { args: { customNodesUrl: 'https://example.invalid/nodes' }, http: 'fetch', hang: true });
add('remote-data-response', { args: { customNodesUrl: 'https://example.invalid/nodes' }, http: 'utils', responseShape: 'data' });
add('remote-string-response', { args: { customNodesUrl: 'https://example.invalid/nodes' }, http: 'utils', responseShape: 'string' });
add('remote-custom-bundle', { args: { custom: encode({ nodesUrl: 'https://example.invalid/nodes' }) }, http: 'utils' });

for (const profile of ['mac', 'mobile', 'router', 'router-bypass', 'router_pbr', 'unknown']) {
  add(`profile-${profile}`, { args: { profile } });
  add(`device-alias-${profile}`, { args: { device: profile } });
}
add('custom-profile', { args: { custom: encode({ profile: 'mobile' }) } });
add('profile-array', { args: { profile: ['mac'] } });
add('multiple-tun-inbounds', {
  content: changedTemplate((value) => { value.inbounds.push({ type: 'tun', tag: 'extra-tun', address: ['172.31.1.1/30'] }); }),
  args: { autoRoute: 'false', autoRedirect: 'true', strictRoute: 'false', excludeUid: '1001', appendRouteExcludeAddress: '10.0.1.1' },
});
for (const [camel, snake] of [['autoRoute', 'auto_route'], ['autoRedirect', 'auto_redirect'], ['strictRoute', 'strict_route']]) {
  for (const value of [true, false, 'true', 'false', 1, 0, '1', '0', 'invalid', null]) {
    add(`${camel}-${value}`, { args: { [camel]: value } });
    add(`${snake}-${value}`, { args: { [snake]: value, profile: 'router-bypass' } });
  }
  add(`custom-${snake}`, { args: { custom: encode({ [snake]: false }) } });
  add(`precedence-${snake}`, { args: { [camel]: true, custom: encode({ [snake]: false }) } });
}
for (const value of ['private-tun', '', 'none', 'null', null]) {
  add(`interface-${value}`, { args: { interfaceName: value } });
}
add('interface-custom-precedence', { args: { interfaceName: 'argument-tun', custom: encode({ interfaceName: 'custom-tun' }) } });
for (const value of ['', null, [], [1001, 1002], '0,1000,invalid,1002']) {
  add(`uids-${JSON.stringify(value)}`, { args: { excludeUid: value } });
}
add('uids-custom-precedence', { args: { excludeUid: [1001], custom: encode({ excludeUid: [] }) } });
for (const value of ['10.0.1.1', '10.0.1.0/24', '2001:db8::1', '2001:db8::1/128', '+10.0.1.1', '%2B10.0.1.1', ' 10.0.1.1', [], '']) {
  add(`addresses-${JSON.stringify(value)}`, { args: { routeExcludeAddress: value } });
}
add('address-alias', { args: { excludeAddress: '10.0.1.1' } });
add('append-address', { args: { appendRouteExcludeAddress: '10.0.1.1' } });
add('append-address-alias', { args: { appendExcludeAddress: '10.0.1.1' } });
add('append-and-replace-precedence', { args: { appendExcludeAddress: '10.0.1.1', routeExcludeAddress: '10.0.2.1' } });
add('custom-append-address', { args: { custom: encode({ appendRouteExcludeAddress: ['10.0.1.1', '2001:db8::1'] }) } });
add('custom-address-precedence', { args: { routeExcludeAddress: '10.0.2.1', custom: encode({ routeExcludeAddress: ['10.0.1.1'] }) } });
for (const key of ['storagePath', 'storage_path', 'storageDir', 'storage_dir', 'storePath', 'storage']) {
  add(`storage-${key}`, { args: { [key]: 'momo' } });
}
for (const value of ['momo', 'true', '/tmp/private/', '/', '']) add(`storage-value-${value}`, { args: { storagePath: value } });
for (const key of ['cachePath', 'cache_path', 'externalUi', 'external_ui']) {
  add(`path-${key}`, { args: { storagePath: 'momo', [key]: '/tmp/private-override' } });
}
add('custom-paths', { args: { custom: encode({ storagePath: '/tmp/private', cachePath: '/tmp/cache', externalUi: '/tmp/ui' }) } });
for (const key of ['bypassDomains', 'directDomains']) {
  add(`domains-${key}`, { args: { [key]: 'PRIVATE.test,another.test' } });
  add(`custom-domains-${key}`, { args: { custom: encode({ [key]: ['PRIVATE.test', 'another.test'] }) } });
}
add('ecs', { args: { clientSubnet: '192.0.2.0/24' } });
add('custom-ecs-precedence', { args: { clientSubnet: '198.51.100.0/24', custom: encode({ clientSubnet: '192.0.2.0/24' }) } });

add('dns-slice-order', { files: [{ dns: { rules: [{ domain: 'private.test', server: 'localDns' }] } }] });
add('multiple-dns-slices', { files: [{ dns: { rules: [{ domain: 'one.test', server: 'localDns' }] } }, { dns: { rules: [{ domain: 'two.test', server: 'proxyDns' }] } }] });
add('dns-server-tags', { files: [{ dns: { servers: [{ tag: 'proxyDns', type: 'udp', server: '192.0.2.1' }, { tag: 'private-dns', type: 'udp', server: '192.0.2.2' }] } }] });
add('dns-fields', { files: [{ dns: { strategy: 'ipv4_only', final: 'localDns', reverse_mapping: false, client_subnet: '192.0.2.0/24' } }] });
add('inbound-tags', { files: [{ inbounds: [{ tag: 'tun-in', type: 'mixed' }, { tag: 'private-in', type: 'mixed', listen_port: 1080 }] }] });
add('rule-set-tags', { files: [{ route: { rule_set: [{ tag: 'geoip-cn', type: 'inline', rules: [] }, { tag: 'private-set', type: 'inline', rules: [] }] } }] });
add('untagged-inbounds-and-rule-sets', { files: [{ inbounds: [{ type: 'mixed' }], route: { rule_set: [{ type: 'inline', rules: [] }] } }] });
add('route-slice-order', { args: { bypassDomains: 'private-direct.test' }, files: [{ route: { rules: [{ domain: 'private-proxy.test', outbound: '🚀 手选节点' }] } }] });
add('route-without-resolve', { content: changedTemplate((value) => { value.route.rules = value.route.rules.filter((rule) => rule.action !== 'resolve'); }), args: { bypassDomains: 'private.test' } });
add('experimental-merge', { files: [{ experimental: { cache_file: { enabled: false }, clash_api: { external_controller: '127.0.0.1:9090' } } }] });
for (const listen of ['::1', '::', '2001:db8::1', '127.0.0.1:12345', '[::1]:12345', '']) {
  add(`api-listener-${listen}`, { files: [{ services: [{ type: 'api', listen, dashboard: { directory: '/tmp/ui' } }] }] });
}
for (const port of [0, 65535, -1, 65536, 'invalid']) {
  add(`api-port-${port}`, { files: [{ services: [{ type: 'api', listen: '::1', listen_port: port }] }] });
}
add('api-path-precedence', { args: { storagePath: 'momo' }, files: [{ services: [{ type: 'api', listen: '::1', dashboard: { directory: '/tmp/old-ui', path: '/tmp/ui' } }] }] });
add('multiple-api-services', { args: { externalUi: '/tmp/private-ui' }, files: [{ services: [{ type: 'api', listen: '::1' }, { type: 'api', listen: '127.0.0.1:9091' }] }] });
for (const value of [true, false]) {
  add(`legacy-cache-${value}`, { files: [{ experimental: { cache_file: { enabled: true, store_rdrc: value } } }] });
  add(`cache-precedence-${value}`, { files: [{ experimental: { cache_file: { enabled: true, store_rdrc: !value, store_dns: value } } }] });
}
add('mixed-dns-modes', { files: [{ dns: { rules: [{ domain: 'private.test', server: 'proxyDns', strategy: 'ipv4_only' }] } }] });
add('invalid-template-tags', { content: changedTemplate((value) => { value.outbounds.push({ type: 'direct', tag: 'direct-out' }); }) });
add('all-proxies-empty', { artifactResult: [] });
add('no-hong-kong-proxy', { artifactResult: [{ ...node, tag: 'TEST-Japan' }] });
add('selector-cycle', { files: [{ outbounds: [{ type: 'selector', tag: 'cycle-one', outbounds: ['cycle-two'] }, { type: 'selector', tag: 'cycle-two', outbounds: ['cycle-one'] }] }] });
for (const placeholders of [['{all}', '{self}'], ['{self}', '{all}'], ['{all}', '{self}', '{all}', '{self}']]) {
  add(`repeated-placeholders-${placeholders.join('-')}`, {
    files: [{ outbounds: [personal, { type: 'selector', tag: 'personal-selector', outbounds: placeholders }] }],
  });
}
add('filter-without-all-placeholder', { files: [{ outbounds: [
  { type: 'selector', tag: 'personal-selector', outbounds: ['direct-out'], filter: [{ action: 'include', keywords: ['['] }] },
] }] });

async function run(source, scenario) {
  const calls = [], requests = [], storage = [], logs = [];
  const timers = new Set();
  let localAttempt = 0;
  const payload = JSON.stringify(scenario.payload === undefined ? [personal] : scenario.payload);
  function responseFor(url) {
    requests.push(url);
    if (scenario.httpError) throw new Error('fixture HTTP failure');
    const local = /127\.0\.0\.1|localhost/.test(url);
    const status = local && localAttempt++ !== (scenario.localSuccess ?? 0) ? 404 : scenario.httpStatus || 200;
    return { status, body: status < 400 ? payload : '' };
  }
  const context = {
    $arguments: { name: 'fixture', ...scenario.args },
    $files: (scenario.files || []).map((value) => typeof value === 'string' ? value : JSON.stringify(value)),
    ProxyUtils: { JSON5: JSON }, Buffer, AbortController,
    console: { log: (...args) => logs.push(args.map(String).join(' ')) },
    setTimeout: (callback, ms) => {
      const timer = setTimeout(() => { timers.delete(timer); callback(); }, Math.min(ms, 1));
      timers.add(timer);
      return timer;
    },
    clearTimeout: (timer) => { timers.delete(timer); clearTimeout(timer); },
    produceArtifact: async (options) => {
      calls.push(clone(options));
      if (options.name === 'personal-sub') {
        if (scenario.selfError) throw new Error('fixture self subscription failure');
        return clone(scenario.selfResult === undefined ? [personal] : scenario.selfResult);
      }
      if (scenario.artifactError) throw new Error('fixture subscription failure');
      return clone(scenario.artifactResult === undefined ? [node] : scenario.artifactResult);
    },
  };
  if (!scenario.omitContent) context.$content = typeof scenario.content === 'string' ? scenario.content : JSON.stringify(scenario.content === undefined ? template : scenario.content);
  if (scenario.http === 'utils' || scenario.http === 'both') context.ProxyUtils.http = {
    get: async (url) => {
      const response = responseFor(url);
      if (scenario.responseShape === 'data') return { status: response.status, data: response.body };
      if (scenario.responseShape === 'string') return response.body;
      return response;
    },
  };
  if (scenario.http === 'callback' || scenario.http === 'both') context.$httpClient = {
    get: (url, callback) => {
      if (scenario.hang) { requests.push(url); return; }
      try { const response = responseFor(url); callback(null, response, response.body); }
      catch (error) { callback(error); }
    },
  };
  if (scenario.http === 'fetch') context.fetch = async (url, { signal }) => {
    if (scenario.hang) {
      requests.push(url);
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('fixture aborted'))));
    }
    const response = responseFor(url);
    return { ok: response.status < 400, text: async () => response.body };
  };
  if (scenario.storeMode) {
    const read = (key) => {
      storage.push(key);
      if (scenario.storeMode === 'throw') throw new Error('fixture storage failure');
      if (scenario.storeMode === 'invalid') return '{invalid';
      if (scenario.storeMode === 'prefix' && !key.startsWith('file/')) return null;
      return payload;
    };
    context.$substore = scenario.storeMode === 'getFile' ? { getFile: async (key) => read(key) } : { read };
  }
  let error = null;
  try { await new vm.Script(`(async () => {\n${source}\n})()`).runInContext(vm.createContext(context), { timeout: 2000 }); }
  catch (value) { error = { name: value.name, message: value.message }; }
  finally { for (const timer of timers) clearTimeout(timer); }
  let output = context.$content;
  try { output = JSON.parse(output); } catch (_) {}
  return { output, serializedOutput: context.$content, calls, requests, storage, logs, error };
}

function difference(a, b, at = '$') {
  if (isDeepStrictEqual(a, b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const found = difference(a[key], b[key], `${at}.${key}`);
      if (found) return found;
    }
  }
  return `${at}: actual=${JSON.stringify(a)?.slice(0, 180)}; baseline=${JSON.stringify(b)?.slice(0, 180)}`;
}

// 用户明确只支持当前模板：无模板兜底、旧 API / 缓存转换不再属于生成合同。
const unsupportedInputs = new Set([
  'node-array-without-template', 'fallback-template-without-inbounds',
  'api-path-precedence', 'multiple-api-services',
]);
const unsupportedPrefixes = ['api-listener-', 'api-port-', 'legacy-cache-', 'cache-precedence-'];
const currentTemplateScenarios = scenarios.filter((scenario) =>
  !unsupportedInputs.has(scenario.name) && !unsupportedPrefixes.some((prefix) => scenario.name.startsWith(prefix)));

test('current 1.14 template and personal parameters preserve their generated output and external behavior', { timeout: 45000 }, async (t) => {
  assert.equal(createHash('sha256').update(baseline).digest('hex'), '7c0dddc1e7c7b985adce20445dab1ed9413a0d2559045272612eb51345507d8d');
  for (const scenario of currentTemplateScenarios) {
    const expected = await run(baseline, scenario);
    for (const candidate of candidates) {
      const actual = await run(candidate.source, scenario);
      const mismatch = difference(actual, expected);
      assert.equal(mismatch, null, `${candidate.file}: ${scenario.name}\n${mismatch}`);
    }
  }
  t.diagnostic(`${currentTemplateScenarios.length} current-template scenarios × ${candidates.length} active scripts match the baseline; old-format migration and missing-template fallbacks are explicitly out of scope.`);
});
