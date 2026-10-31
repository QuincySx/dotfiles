const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
const template14 = JSON.parse(read('source/sing_config_template_1.14.json'));
const template13 = JSON.parse(read('source/sing_config_template_1.13.json'));
const scripts = ['sub_store_sb_convert.js', 'sub_store_sb_convert_1.14.js'];
const proxy = {
  type: 'anytls', tag: 'TEST-Hong Kong', server: '127.0.0.1', server_port: 443,
  password: 'test-fixture-only', tls: { enabled: true, server_name: 'example.com' },
};

function apiServiceTemplate() {
  const template = clone(template14);
  delete template.experimental.clash_api;
  template.services = [{
    type: 'api', tag: 'api', listen: '127.0.0.1', listen_port: 9090,
    dashboard: { path: 'ui' },
  }];
  return template;
}

async function convert({ template = template14, script = scripts[0], args = {}, files = [], proxies = [proxy], produceError } = {}) {
  const calls = [];
  const context = vm.createContext({
    $arguments: { name: 'fixture', ...args },
    $content: JSON.stringify(template),
    $files: files.map((file) => JSON.stringify(file)),
    ProxyUtils: { JSON5: JSON },
    Buffer,
    console: { log() {} },
    produceArtifact: async (options) => {
      calls.push(options);
      if (produceError) throw new Error(produceError);
      return clone(proxies);
    },
  });
  await new vm.Script(`(async () => {\n${read(`script/sub-store/${script}`)}\n})()`).runInContext(context, { timeout: 2000 });
  return { config: JSON.parse(context.$content), calls };
}

function assertReferences(config) {
  const tags = config.outbounds.map((outbound) => outbound.tag);
  assert.equal(new Set(tags).size, tags.length, 'duplicate outbound tags');
  for (const outbound of config.outbounds) {
    assert(!outbound.filter, 'template filter leaked');
    for (const tag of outbound.outbounds || []) assert(tags.includes(tag), `missing outbound ${tag}`);
    if (outbound.default) assert(outbound.outbounds.includes(outbound.default));
  }
  assert(!JSON.stringify(config).includes('{all}'));
}

test('public template/script aliases stay synchronized', () => {
  for (const file of ['source/sing_config_template.json', 'sing/sing_config_template_backup.json', 'sing/sing_config_template_backup_1.14.json']) {
    assert.equal(read(file), read('source/sing_config_template_1.14.json'));
  }
  assert.equal(read('sing/sing_config_template_backup_1.13.json'), read('source/sing_config_template_1.13.json'));
  assert.equal(read('script/sub-store/sub_store_sb_convert.js'), read('script/sub-store/sub_store_sb_convert_1.14.js'));
});

test('the template contains the full routing policy without script-generated rules', async () => {
  const { config } = await convert();
  assert.deepEqual(config.route.rules, template14.route.rules);
});

test('Clash API settings survive conversion without creating a different API service', async () => {
  const { config } = await convert();
  assert.deepEqual(config.experimental.clash_api, template14.experimental.clash_api);
  assert(!config.services);
});

test('Claude and HubSpot business routes precede privacy, ads and mode rules', () => {
  const rules = template14.route.rules;
  const claude = rules.findIndex((rule) => rule.outbound === '🤖 Claude分流');
  const hubspot = rules.findIndex((rule) => rule.domain_suffix?.includes('hubspot.com'));
  assert(claude > rules.findIndex((rule) => rule.action === 'resolve'));
  assert.equal(hubspot, claude + 1);
  for (const rule of rules.filter((rule) => rule.clash_mode || ['🍃 应用净化分流', '🛑 广告分流'].includes(rule.outbound))) {
    assert(hubspot < rules.indexOf(rule));
  }
});

test('bootstrap uses IP-addressed direct DoH, without UDP/QUIC/domain recursion', () => {
  for (const template of [template13, template14]) {
    for (const tag of ['resolverDns', 'localDns']) {
      const server = template.dns.servers.find((item) => item.tag === tag);
      assert.equal(server.type, 'https');
      assert.equal(server.server, '223.5.5.5');
      assert.equal(server.tls.server_name, 'dns.alidns.com');
      assert(!server.domain_resolver);
      assert(!server.detour);
    }
    assert.deepEqual(template.route.default_domain_resolver, { server: 'resolverDns', strategy: 'ipv4_only' });
    const remote = template.dns.servers.find((item) => item.tag === 'proxyDns');
    assert.equal(remote.server, '8.8.8.8');
    assert.equal(remote.tls.server_name, 'dns.google');
    assert.equal(remote.detour, '🚀 手选节点');
    assert(!template.outbounds.some((outbound) => outbound.tag === '⚡ DNS 分流'));
  }
});

for (const script of scripts) {
  test(`${script}: router-bypass + storagePath=momo generates correct paths/references`, async () => {
    const { config, calls } = await convert({ script, args: { profile: 'router-bypass', storagePath: 'momo', v: '1.14.4' } });
    assert.equal(calls[0].platform, 'sing-box');
    assertReferences(config);
    assert.equal(config.experimental.cache_file.path, '/etc/momo/run/cache.db');
    assert.equal(config.experimental.clash_api.external_ui, '/etc/momo/run/ui');
    assert(!config.services);
    const tun = config.inbounds[0];
    assert.equal(tun.interface_name, 'momo');
    assert.equal(tun.auto_redirect, true);
    assert.equal(tun.strict_route, true);
    assert.deepEqual(tun.exclude_uid, [1000]);
    assert.deepEqual(tun.route_exclude_address, ['5.5.5.5/32', '10.10.1.20/32']);
    assert.deepEqual(tun.route_exclude_address_set, ['geoip-cn']);
  });
}

for (const listen of ['::1', '::', '2001:db8::1']) {
  test(`IPv6 API listener ${listen} is not widened or truncated`, async () => {
    const template = apiServiceTemplate();
    template.services[0].listen = listen;
    const { config } = await convert({ template });
    assert.equal(config.services[0].listen, listen);
    assert.equal(config.services[0].listen_port, 9090);
  });
}

for (const [input, expectedHost, expectedPort] of [['127.0.0.1:12345', '127.0.0.1', 12345], ['[::1]:12345', '::1', 12345]]) {
  test(`legacy API host:port ${input} is split safely`, async () => {
    const template = apiServiceTemplate();
    template.services[0].listen = input;
    delete template.services[0].listen_port;
    const { config } = await convert({ template });
    assert.equal(config.services[0].listen, expectedHost);
    assert.equal(config.services[0].listen_port, expectedPort);
  });
}

test('legacy dashboard.directory is migrated to path', async () => {
  const template = apiServiceTemplate();
  delete template.services[0].dashboard.path;
  template.services[0].dashboard.directory = '/tmp/test-ui';
  const { config } = await convert({ template });
  assert.equal(config.services[0].dashboard.path, '/tmp/test-ui');
  assert(!('directory' in config.services[0].dashboard));
});

for (const version of ['1.14', '1.14.0', '1.14.4', 'v1.14.4', '1.14.4-beta.1']) {
  test(`${version} generates the 1.14 configuration`, async () => {
    const { config } = await convert({ args: { v: version, storagePath: 'momo' } });
    assert(config.experimental.clash_api);
    assert(!config.services);
    assert(config.http_clients);
    assert.equal(config.experimental.cache_file.store_dns, true);
    assertReferences(config);
  });
}

for (const version of ['1.13', '1.13.12', '1.15']) {
  test(`${version} is rejected by the 1.14-only entry point`, async () => {
    await assert.rejects(convert({ args: { v: version } }), /仅支持 1.14/);
  });
}

test('legacy DNS input is preserved when generating 1.14', async () => {
  const { config } = await convert({ template: template13, args: { v: '1.14.4' } });
  assert(config.dns.rules.some((rule) => rule.strategy === 'ipv4_only'));
  assert.deepEqual(config.experimental.clash_api, template13.experimental.clash_api);
  assert(!config.services);
});

test('mixed legacy strategy and modern DNS matching is rejected with an actionable message', async () => {
  const template = clone(template14);
  template.dns.rules[1].strategy = 'ipv4_only';
  await assert.rejects(convert({ template }), /legacy strategy 不能与/);
});

test('ECS argument is applied to remote DNS routing rules', async () => {
  const { config } = await convert({ args: { clientSubnet: '192.0.2.0/24' } });
  const rules = config.dns.rules.filter((rule) => rule.server === 'proxyDns');
  assert(rules.length > 0);
  assert(rules.every((rule) => rule.client_subnet === '192.0.2.0/24'));
});

test('local-only mode does not call subscription generation', async () => {
  const custom = { ...proxy, tag: 'self-local' };
  const { config, calls } = await convert({ args: { name: undefined }, files: [[custom]], produceError: 'must not be called' });
  assert.equal(calls.length, 0);
  assert(config.outbounds.some((outbound) => outbound.tag === custom.tag));
  assertReferences(config);
});

test('customNodes=none disables the custom-node slice pool', async () => {
  const { config } = await convert({ args: { customNodes: 'none' }, files: [[{ ...proxy, tag: 'self-disabled' }]] });
  assert(!config.outbounds.some((outbound) => outbound.tag === 'self-disabled'));
});

test('template tag collisions fail clearly, duplicate subscribed nodes are deduplicated', async () => {
  await assert.rejects(convert({ files: [[{ ...proxy, tag: 'direct-out' }]] }), /节点 tag 与模板出站冲突/);
  const { config } = await convert({ proxies: [proxy, proxy] });
  assert.equal(config.outbounds.filter((outbound) => outbound.tag === proxy.tag).length, 1);
});

test('missing Hong Kong nodes does not silently send default remote DNS direct', async () => {
  const japan = { ...proxy, tag: 'TEST-Japan' };
  const { config } = await convert({ proxies: [japan] });
  const manual = config.outbounds.find((outbound) => outbound.tag === '🚀 手选节点');
  const hk = config.outbounds.find((outbound) => outbound.tag === '🇭🇰 香港自动节点');
  assert.deepEqual(hk.outbounds, [japan.tag]);
  assert.equal(manual.default, '🇭🇰 香港自动节点');
  assert(!config.outbounds.some((outbound) => outbound.tag === 'COMPATIBLE'));
});

for (const profile of ['mac', 'mobile']) {
  test(`${profile} clears inherited router-only settings`, async () => {
    const { config } = await convert({ args: { profile } });
    const tun = config.inbounds[0];
    assert.equal(tun.auto_redirect, false);
    assert.deepEqual(tun.exclude_uid, []);
    assert.deepEqual(tun.route_exclude_address, []);
    assert.deepEqual(tun.route_exclude_address_set, []);
  });
}

// Optional real-core checks: node this-file.cjs /path/to/sing-box-1.14.4
const binary = process.argv[2];
test('1.14.4 real core accepts the generated configuration', { skip: !binary }, async () => {
  const { config } = await convert({ args: { profile: 'mac', storagePath: '/tmp/sb-test-storage' } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-test-'));
  try {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify(config));
    const result = spawnSync(binary, ['check', '-c', file, '-D', dir], { encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('1.14 real DNS queries distinguish domestic, foreign and unclassified domains', { skip: !binary, timeout: 30000 }, async (t) => {
  const { config } = await convert({ args: { profile: 'mac' } });
  await require('./dns_policy_fixture.cjs').checkDns(t, binary, config);
});

test('1.14 actual connections enforce foreign IPv4 and retain dual-stack fallback elsewhere', { skip: !binary, timeout: 30000 }, async (t) => {
  const { config } = await convert({
    args: { profile: 'mac', bypassDomains: 'unknown-v6only.test' },
    files: [{ route: { rules: [{ domain: ['foreign-explicit.test'], action: 'route', outbound: 'direct-out' }] } }],
  });
  await require('./dns_policy_fixture.cjs').checkConnections(t, binary, config);
});

test('1.14 Clash REST API and dashboard remain available', { skip: !binary, timeout: 20000 }, async (t) => {
  const { config } = await convert();
  await require('./dns_policy_fixture.cjs').checkClashApi(t, binary, config);
});
