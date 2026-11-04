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
const scripts = ['sub_store_sb_convert.js', 'sub_store_sb_convert_1.14.js'];
const proxy = {
  type: 'anytls', tag: 'TEST-Hong Kong', server: '127.0.0.1', server_port: 443,
  password: 'test-fixture-only', tls: { enabled: true, server_name: 'example.com' },
};

async function convert({ template = template14, script = scripts[0], args = {}, files = [], proxies = [proxy], selfProxies, produceError, runtime = {} } = {}) {
  const calls = [];
  const context = vm.createContext({
    $arguments: { name: 'fixture', ...args },
    $content: JSON.stringify(template),
    $files: files.map((file) => JSON.stringify(file)),
    ProxyUtils: { JSON5: JSON },
    Buffer,
    setTimeout,
    clearTimeout,
    console: { log() {} },
    produceArtifact: async (options) => {
      calls.push(options);
      if (produceError) throw new Error(produceError);
      if (selfProxies && options.name === args.selfSub) return clone(selfProxies);
      return clone(proxies);
    },
    ...runtime,
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
  assert(!JSON.stringify(config).includes('{self}'));
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
  for (const template of [template14]) {
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

test('a self-hosted node file can appear before the template file', async () => {
  const custom = { ...proxy, tag: '东京主力' };
  const { config } = await convert({ template: [custom], files: [template14] });
  assert(config.outbounds.some((outbound) => outbound.tag === custom.tag));
  assert(config.outbounds.find((outbound) => outbound.tag === '🤖 GPT分流').outbounds.includes(custom.tag));
  assertReferences(config);
});

test('node files alone fail clearly instead of being treated as a template', async () => {
  await assert.rejects(convert({ template: [proxy] }), /未找到当前 1.14 配置模板/);
});

test('an arbitrary config object is not guessed to be the current template', async () => {
  const template = clone(template14);
  delete template.inbounds;
  await assert.rejects(convert({ template }), /未找到当前 1.14 配置模板/);
});

test('an explicit self-hosted subscription retains source identity without requiring self in node names', async () => {
  const custom = { ...proxy, tag: '东京主力' };
  const { config, calls } = await convert({ args: { selfSub: 'personal-fixture' }, selfProxies: [custom] });
  assert.deepEqual(calls.map((call) => call.name), ['fixture', 'personal-fixture']);
  assert.deepEqual(config.outbounds.find((outbound) => outbound.tag === '🏴☠️ 自建节点').outbounds,
    [custom.tag, 'block-out', 'direct-out']);
});

test('named node files use the provided Sub-Store reader without probing HTTP ports', async () => {
  const custom = { ...proxy, tag: '本地自建' };
  const { config } = await convert({ args: { localFile: 'personal-fixture' }, runtime: {
    $substore: { read: (name) => name === 'personal-fixture' ? JSON.stringify([custom]) : null },
    ProxyUtils: { JSON5: JSON, http: { get() { throw new Error('must not probe local HTTP ports'); } } },
  } });
  assert(config.outbounds.find((outbound) => outbound.tag === '🏴☠️ 自建节点').outbounds.includes(custom.tag));
});

test('explicit remote and Base64 node sources remain available', async () => {
  const remote = { ...proxy, tag: '外链自建' };
  const encoded = { ...proxy, tag: '编码自建' };
  const calls = [];
  const { config } = await convert({ args: {
    customNodesUrl: 'https://example.invalid/nodes',
    customNodes: Buffer.from(JSON.stringify([encoded])).toString('base64'),
  }, runtime: { ProxyUtils: { JSON5: JSON, http: { get: async (url) => {
    calls.push(url);
    return { status: 200, body: JSON.stringify([remote]) };
  } } } } });
  assert.deepEqual(calls, ['https://example.invalid/nodes']);
  for (const node of [remote, encoded]) assert(config.outbounds.some((outbound) => outbound.tag === node.tag));
  assertReferences(config);
});

test('personal route exclusions and TUN overrides retain their existing behavior', async () => {
  const { config } = await convert({ args: {
    appendRouteExcludeAddress: ['10.0.1.1', '2001:db8::1/128'], interfaceName: 'personal-tun', autoRoute: 'false',
  } });
  const tun = config.inbounds[0];
  assert.deepEqual(tun.route_exclude_address, ['5.5.5.5/32', '10.10.1.20/32', '10.0.1.1/32', '2001:db8::1/128']);
  assert.equal(tun.interface_name, 'personal-tun');
  assert.equal(tun.auto_route, false);
});

for (const script of scripts) {
  test(`${script}: DNS slices stay after the foreign guard, with later slices taking priority`, async () => {
    const { config } = await convert({ script, files: [
      { dns: { rules: [{ domain: ['one.test'], action: 'route', server: 'localDns' }] } },
      { dns: { rules: [{ domain: ['two.test'], action: 'route', server: 'proxyDns' }] } },
    ] });
    assert.deepEqual(config.dns.rules[0], template14.dns.rules[0]);
    assert.deepEqual(config.dns.rules.slice(1, 3).map((rule) => rule.domain), [['two.test'], ['one.test']]);
    assert.deepEqual(config.dns.rules.slice(3), template14.dns.rules.slice(1));
  });

  test(`${script}: bundled custom append addresses are applied`, async () => {
    for (const key of ['appendRouteExcludeAddress', 'appendExcludeAddress']) {
      const custom = Buffer.from(JSON.stringify({ [key]: ['192.0.2.123', '2001:db8::1/128'] })).toString('base64');
      const { config } = await convert({ script, args: { custom } });
      assert.deepEqual(config.inbounds[0].route_exclude_address,
        ['5.5.5.5/32', '10.10.1.20/32', '192.0.2.123/32', '2001:db8::1/128']);
    }
  });

  test(`${script}: routers keep domestic IP exclusion, with conditional fallback for core traffic`, async () => {
    for (const profile of [undefined, 'mac', 'router', 'router-bypass', 'router_pbr', 'mobile']) {
      const { config } = await convert({ script, args: { profile } });
      const excluded = ['mac', 'mobile'].includes(profile) ? [] : ['geoip-cn'];
      assert.deepEqual(config.inbounds.find((inbound) => inbound.type === 'tun').route_exclude_address_set, excluded);
      assert(!config.route.rules.some((rule) => rule.rule_set === 'geoip-cn'));
      const fallback = config.route.rules.find((rule) => rule.type === 'logical' &&
        rule.rules?.some((condition) => condition.rule_set === 'geoip-cn'));
      assert.deepEqual(fallback, {
        type: 'logical', mode: 'and',
        rules: [{ rule_set: 'geoip-cn' }, { rule_set: 'geosite-geolocation-!cn', invert: true }],
        action: 'bypass', outbound: 'direct-out',
      });
      const customProxy = config.route.rules.find((rule) => rule.rule_set?.includes('ac-custom-proxy'));
      assert(config.route.rules.indexOf(fallback) > config.route.rules.indexOf(customProxy));
      assert(config.route.rule_set.some((rule) => rule.tag === 'geoip-cn'));
    }
  });
}

test('customNodes=none disables the custom-node slice pool', async () => {
  const { config } = await convert({ args: { customNodes: 'none' }, files: [[{ ...proxy, tag: 'self-disabled' }]] });
  assert(!config.outbounds.some((outbound) => outbound.tag === 'self-disabled'));
  assert.deepEqual(config.outbounds.find((outbound) => outbound.tag === '🏴☠️ 自建节点').outbounds,
    ['block-out', 'direct-out']);
  assertReferences(config);
});

for (const script of scripts) {
  test(`${script}: self-hosted nodes and their group are directly available in common selectors`, async () => {
    const custom = [{ ...proxy, tag: '东京主力' }, { ...proxy, tag: '洛杉矶主力' }];
    const legacy = { ...proxy, tag: 'self-legacy' };
    const { config } = await convert({ script, proxies: [proxy, legacy], files: [[...custom, custom[0]]] });
    const selfTags = [legacy.tag, ...custom.map((node) => node.tag), `${custom[0].tag} 1`];
    for (const tag of ['🚀 手选节点', '🤖 GPT分流', '🤖 Claude分流', '🚀 CDN 分流', '🎥 流媒体分流', '🐟 漏网分流']) {
      const group = config.outbounds.find((outbound) => outbound.tag === tag);
      assert.deepEqual(group.outbounds.slice(0, selfTags.length + 1), [...selfTags, '🏴☠️ 自建节点']);
      assert.equal(new Set(group.outbounds).size, group.outbounds.length);
      assert.equal(group.default, template14.outbounds.find((outbound) => outbound.tag === tag).default);
    }
    const selfGroup = config.outbounds.find((outbound) => outbound.tag === '🏴☠️ 自建节点');
    assert.deepEqual(selfGroup.outbounds, [...selfTags, 'block-out', 'direct-out']);
    assert(!selfGroup.outbounds.includes(proxy.tag), 'airport nodes must not fill the self-hosted group');
    assertReferences(config);
  });
}

test('YouTube, Netflix, Disney and Spotify share one selector before generic CDN and Google routing', async () => {
  const { config } = await convert();
  const media = config.route.rules.find((rule) => rule.outbound === '🎥 流媒体分流');
  for (const tag of ['geosite-youtube', 'geosite-netflix', 'geosite-disney', 'geosite-spotify']) {
    assert(media.rule_set.includes(tag));
  }
  for (const rule of config.route.rules.filter((rule) =>
    rule.outbound === '🚀 CDN 分流' || rule.domain_suffix?.includes('googleapis.com'))) {
    assert(config.route.rules.indexOf(media) < config.route.rules.indexOf(rule));
  }
  assertReferences(config);
});

test('Google AI uses GPT with proxy DNS and explicit foreign family limits', async () => {
  const { config } = await convert();
  const googleAi = config.route.rule_set.find((rule) => rule.tag === 'geosite-google-ai');
  assert.equal(googleAi.url, 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/google-deepmind.srs');
  const gpt = config.route.rules.find((rule) => rule.rule_set?.includes('geosite-google-ai'));
  // The IPv6 guard is logical; the business route must be a separate terminal route.
  assert.equal(gpt.outbound, '🤖 GPT分流');
  for (const rule of config.route.rules.filter((rule) => rule.domain_suffix?.includes('googleapis.com') || rule.outbound === '🚀 CDN 分流')) {
    assert(config.route.rules.indexOf(gpt) < config.route.rules.indexOf(rule));
  }
  assert(config.dns.rules[0].rule_set.includes('geosite-google-ai'));
  const dns = config.dns.rules.find((rule) => rule.server === 'proxyDns' && rule.rule_set?.includes('geosite-google-ai'));
  assert(dns);
  assert(config.route.rules.some((rule) => rule.action === 'reject' && rule.rules?.some((condition) => condition.rule_set?.includes('geosite-google-ai'))));
  assertReferences(config);
});

test('streaming lists all JP/HK/SG nodes directly and removes the separate Netflix selector', async () => {
  const regional = ['🇯🇵 日本 01', 'JP 02', '日本 游戏 03', '日01', '🇭🇰 香港 01', 'HK 02',
    'Hong Kong 03', '港游戏 04', '🇸🇬 新加坡 01', 'SG 02', 'Singapore 03', '狮城游戏 04',
    'JP02', 'HK03', 'sg04', 'HKG05', 'JPN06', 'SGP07'];
  const excluded = ['🇺🇸 美国日用', '🇹🇼 台湾 01', 'HK 剩余流量 100G', '🇺🇸 USGame 01',
    'USGateway 01', 'ASGARD 01', 'SHK 01', 'MYJPLink 01'];
  const custom = [{ ...proxy, tag: '洛杉矶主力' }, { ...proxy, tag: 'self-JP 02' }];
  const { config } = await convert({
    proxies: [...regional, ...excluded].map((tag) => ({ ...proxy, tag })), files: [custom],
  });
  const media = config.outbounds.find((outbound) => outbound.tag === '🎥 流媒体分流');
  for (const tag of [...regional, ...custom.map((node) => node.tag), '🏴☠️ 自建节点']) {
    assert(media.outbounds.includes(tag), `missing streaming option ${tag}`);
  }
  for (const tag of excluded) assert(!media.outbounds.includes(tag), `unexpected streaming node ${tag}`);
  assert.equal(new Set(media.outbounds).size, media.outbounds.length);
  assert.equal(media.default, '🚀 手选节点');
  assert(!JSON.stringify(config).includes('🎥 奈飞节点'));
  for (const [groupTag, unexpected] of [
    ['🇸🇬 狮城节点', ['USGateway 01', 'ASGARD 01']],
    ['🇭🇰 香港节点', ['SHK 01']],
    ['🇯🇵 日本节点', ['MYJPLink 01']],
  ]) {
    const group = config.outbounds.find((outbound) => outbound.tag === groupTag);
    for (const tag of unexpected) assert(!group.outbounds.includes(tag), `${tag} misclassified into ${groupTag}`);
  }
  assertReferences(config);
});

for (const script of scripts) {
  test(`${script}: duplicate node names get numbered without replacing existing names or sources`, async () => {
    const logs = [];
    const airport = { ...proxy, tag: '主力', server: '192.0.2.10' };
    const custom = { ...proxy, tag: '主力', server: '192.0.2.20' };
    const { config } = await convert({ script,
      proxies: [airport, { ...airport, tag: '主力 1' }, airport],
      files: [[custom, { ...custom, server: '192.0.2.21' }, { ...custom, tag: 'direct-out' }]],
      runtime: { console: { log: (message) => logs.push(message) } },
    });
    for (const [tag, server] of [
      ['主力', '192.0.2.10'], ['主力 1', '192.0.2.10'], ['主力 2', '192.0.2.10'],
      ['主力 3', '192.0.2.20'], ['主力 4', '192.0.2.21'], ['direct-out 1', '192.0.2.20'],
    ]) assert.equal(config.outbounds.find((outbound) => outbound.tag === tag)?.server, server);
    const selfTags = ['主力 3', '主力 4', 'direct-out 1'];
    assert.deepEqual(config.outbounds.find((outbound) => outbound.tag === '🏴☠️ 自建节点').outbounds,
      [...selfTags, 'block-out', 'direct-out']);
    assert.deepEqual(config.outbounds.find((outbound) => outbound.tag === '🤖 GPT分流').outbounds.slice(0, 3), selfTags);
    assert.equal(config.outbounds.find((outbound) => outbound.tag === 'direct-out').type, 'direct');
    assert(logs.some((message) => message.includes('主力 → 主力 3')));
    assertReferences(config);
  });

  test(`${script}: renamed self-hosted chains and selectors keep their own source references`, async () => {
    const { config } = await convert({ script, proxies: [{ ...proxy, tag: '同名' }], files: [[
      { ...proxy, tag: '同名', server: '192.0.2.20' },
      { ...proxy, tag: '自建链', detour: '同名' },
      { type: 'selector', tag: '自建选择', outbounds: ['同名'], default: '同名' },
    ]] });
    assert.equal(config.outbounds.find((outbound) => outbound.tag === '自建链').detour, '同名 1');
    const selector = config.outbounds.find((outbound) => outbound.tag === '自建选择');
    assert.deepEqual(selector.outbounds, ['同名 1']);
    assert.equal(selector.default, '同名 1');
    assertReferences(config);
  });

  test(`${script}: multiple named node files retain each same-named self-hosted node`, async () => {
    for (const args of [
      { localFiles: ['one', 'two'] },
      { custom: Buffer.from(JSON.stringify({ localFiles: ['one', 'two'] })).toString('base64') },
    ]) {
      const reads = [];
      const { config } = await convert({ script, args, runtime: {
        $substore: { read: (name) => {
          reads.push(name);
          return JSON.stringify([{ ...proxy, tag: '本地自建', server: name === 'one' ? '192.0.2.20' : '192.0.2.21' }]);
        } },
      } });
      assert.deepEqual(reads, ['one', 'two']);
      assert.equal(config.outbounds.find((outbound) => outbound.tag === '本地自建').server, '192.0.2.20');
      assert.equal(config.outbounds.find((outbound) => outbound.tag === '本地自建 1').server, '192.0.2.21');
      assert.deepEqual(config.outbounds.find((outbound) => outbound.tag === '🏴☠️ 自建节点').outbounds,
        ['本地自建', '本地自建 1', 'block-out', 'direct-out']);
      assertReferences(config);
    }
  });
}

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
    files: [{
      dns: { rules: [{ domain: ['foreign-v6only.test'], action: 'route', server: 'proxyDns' }] },
      route: { rules: [{ domain: ['foreign-explicit.test'], action: 'route', outbound: 'direct-out' }] },
    }],
  });
  await require('./dns_policy_fixture.cjs').checkConnections(t, binary, config);
});

test('1.14 traffic entering the core keeps business rules ahead of domestic IP fallback', { skip: !binary, timeout: 30000 }, async (t) => {
  const { config } = await convert({ args: { profile: 'mac' } });
  await require('./dns_policy_fixture.cjs').checkFallback(t, binary, config);
});

test('1.14 Clash REST API and dashboard remain available', { skip: !binary, timeout: 20000 }, async (t) => {
  const { config } = await convert();
  await require('./dns_policy_fixture.cjs').checkClashApi(t, binary, config);
});

require('./refactor_equivalence.cjs');
