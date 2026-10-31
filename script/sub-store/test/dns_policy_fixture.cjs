const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const dns = require('node:dns/promises');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { promisify } = require('node:util');

const run = promisify(execFile);
const closeServer = (server) => new Promise((resolve) => server.close(resolve));
const hubspotDomains = ['hs-analytics.net', 'track.hs-analytics.net', 'hs-scripts.com', 'js.hs-scripts.com', 'hubspot.com', 'app.hubspot.com'];
const foreignDomains = ['foreign-explicit.test', 'foreign-cdn.test', 'claude.ai', 'clau.de', 'foreign-fallback.test', 'direct-first.test', ...hubspotDomains];

async function listen(server, options) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options, resolve);
  });
  return server.address().port;
}

async function upstream(t, local, loopback = false) {
  const socket = dgram.createSocket('udp4');
  const requests = [];
  socket.on('message', (query, peer) => {
    let offset = 12;
    const labels = [];
    while (query[offset]) {
      const length = query[offset++];
      labels.push(query.toString('ascii', offset, offset + length));
      offset += length;
    }
    const name = labels.join('.');
    const type = query.readUInt16BE(++offset);
    const question = query.subarray(12, offset + 4);
    requests.push({ name, type });
    const domestic = local && /^(domestic|direct-first|direct-local|unknown-cn)\./.test(name);
    const ipv6 = Buffer.from(loopback ? '00000000000000000000000000000001' :
      domestic ? '20010db8000100000000000000000025' : '20010db8000200000000000000000025', 'hex');
    let data;
    if (type === 1 && !name.includes('-v6only.')) {
      data = Buffer.from(loopback ? [127, 0, 0, 1] : domestic ? [203, 0, 113, 25] : [198, 51, 100, 25]);
    }
    if (type === 28 && !name.includes('-v4only.')) data = ipv6;
    // HTTPS/SVCB records deliberately carry ipv6hint, even if AAAA is suppressed.
    if (type === 64 || type === 65) data = Buffer.concat([Buffer.from([0, 1, 0, 0, 6, 0, 16]), ipv6]);
    const header = Buffer.alloc(12);
    query.copy(header, 0, 0, 2);
    header.writeUInt16BE(0x8180, 2);
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(data ? 1 : 0, 6);
    let answer = Buffer.alloc(0);
    if (data) {
      const record = Buffer.alloc(12);
      record.writeUInt16BE(0xc00c, 0);
      record.writeUInt16BE(type, 2);
      record.writeUInt16BE(1, 4);
      record.writeUInt32BE(60, 6);
      record.writeUInt16BE(data.length, 10);
      answer = Buffer.concat([record, data]);
    }
    socket.send(Buffer.concat([header, question, answer]), peer.port, peer.address);
  });
  socket.bind(0, '127.0.0.1');
  await once(socket, 'listening');
  t.after(() => new Promise((resolve) => socket.close(resolve)));
  return { port: socket.address().port, requests };
}

function configureDns(config, local, remote) {
  config.experimental.cache_file = { enabled: false };
  config.dns.servers = config.dns.servers.map((server) => server.type === 'hosts' ? server : {
    type: 'udp', tag: server.tag, server: '127.0.0.1',
    server_port: server.tag === 'proxyDns' ? remote.port : local.port,
  });
  const fixtureDomains = {
    'ac-custom-direct': ['direct-first.test', 'direct-local.test'],
    'ac-openai': ['foreign-explicit.test', 'direct-first.test'],
    'geosite-lite-cn': ['domestic.test', 'domestic-v4only.test', 'domestic-v6only.test', 'claude.ai'],
    // Force the user-approved early routes to win over an overlapping ad rule.
    'geosite-category-ads-all': ['claude.ai', ...hubspotDomains],
    'proxy-domain-cdn': ['foreign-cdn.test'],
    'geosite-geolocation-!cn': ['foreign-fallback.test', 'foreign-v6only.test'],
  };
  config.route.rule_set = config.route.rule_set.map(({ tag }) => tag === 'ac-claude' ? {
    type: 'local', tag, format: 'binary', path: path.resolve(__dirname, '../../../sing/rules/Ac-claude-proxy.srs'),
  } : ({
    type: 'inline', tag,
    rules: tag === 'geoip-cn' ? [{ ip_cidr: ['203.0.113.0/24', '2001:db8:1::/48'] }] :
      [{ domain: fixtureDomains[tag] || ['never-matched.invalid'] }],
  }));
  config.services = [];
  delete config.experimental.clash_api;
}

async function startCore(t, binary, config) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-family-policy-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  config.log.level = 'info';
  const file = path.join(directory, 'config.json');
  fs.writeFileSync(file, JSON.stringify(config));
  const check = spawnSync(binary, ['check', '-c', file, '-D', directory], { encoding: 'utf8', timeout: 10000 });
  assert.equal(check.status, 0, `${check.error || ''}\n${check.stdout}\n${check.stderr}`);
  const core = spawn(binary, ['run', '-c', file, '-D', directory], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  t.after(async () => {
    if (!core.pid || core.exitCode !== null || core.signalCode !== null) return;
    const exited = once(core, 'exit');
    core.kill('SIGTERM');
    const timer = setTimeout(() => core.kill('SIGKILL'), 2000);
    try { await exited; } finally { clearTimeout(timer); }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`core startup timed out\n${logs}`)), 10000);
    const collect = (data) => {
      logs += data;
      if (logs.includes('sing-box started')) { clearTimeout(timer); resolve(); }
    };
    core.stdout.on('data', collect);
    core.stderr.on('data', collect);
    core.once('error', (error) => { clearTimeout(timer); reject(error); });
    core.once('exit', (code) => { clearTimeout(timer); reject(new Error(`core exited ${code}\n${logs}`)); });
  });
  return () => logs;
}

exports.checkDns = async function checkDns(t, binary, config) {
  const local = await upstream(t, true);
  const remote = await upstream(t, false);
  const reservation = dgram.createSocket('udp4');
  reservation.bind(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  configureDns(config, local, remote);
  config.inbounds = [{ type: 'direct', tag: 'dns-test', listen: '127.0.0.1', listen_port: port,
    network: 'udp', override_address: '127.0.0.1', override_port: 53 }];
  config.outbounds = [{ type: 'direct', tag: 'direct-out' }];
  config.route.rules = [{ inbound: 'dns-test', action: 'hijack-dns' }];
  config.route.final = 'direct-out';
  await startCore(t, binary, config);
  const resolver = new dns.Resolver({ timeout: 1000, tries: 1 });
  resolver.setServers([`127.0.0.1:${port}`]);
  for (const name of foreignDomains) {
    assert.deepEqual(await resolver.resolve4(name), ['198.51.100.25'], `${name}: IPv4 must remain usable`);
    for (const type of ['AAAA', 'TYPE65', 'TYPE64']) {
      const before = local.requests.length + remote.requests.length;
      const { stdout } = await run('dig', ['@127.0.0.1', '-p', String(port), name, type,
        '+noall', '+comments', '+answer', '+tries=1', '+time=1'], { timeout: 5000 });
      assert.match(stdout, /status: NOERROR/, `${name} ${type}: ${stdout}`);
      const answers = stdout.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith(';'));
      assert.deepEqual(answers, [], `${name} ${type} must return no address or IPv6 hint`);
      assert.equal(local.requests.length + remote.requests.length, before, `${name} ${type} must not reach either upstream`);
    }
  }
  assert(remote.requests.some((query) => query.name === 'claude.ai' && query.type === 1),
    'Claude must use proxyDns before an overlapping domestic rule');
  assert(!local.requests.some((query) => query.name === 'claude.ai'),
    'an overlapping domestic rule must not capture Claude DNS queries');
  for (const name of ['domestic.test', 'direct-local.test', 'unknown-cn.test', 'unknown-foreign.test']) {
    const domestic = name !== 'unknown-foreign.test';
    assert.deepEqual(await resolver.resolve4(name), [domestic ? '203.0.113.25' : '198.51.100.25']);
    assert.deepEqual(await resolver.resolve6(name), [domestic ? '2001:db8:1::25' : '2001:db8:2::25'],
      `${name}: IPv6 must remain available`);
  }
};

exports.checkConnections = async function checkConnections(t, binary, config) {
  const local = await upstream(t, true, true);
  const remote = await upstream(t, false, true);
  const backend = (family) => http.createServer((request, response) => {
    response.setHeader('Connection', 'close');
    response.end(family);
  });
  const v4 = backend('IPv4');
  const webPort = await listen(v4, { host: '127.0.0.1', port: 0 });
  t.after(() => closeServer(v4));
  const v6 = backend('IPv6');
  await listen(v6, { host: '::1', port: webPort, ipv6Only: true });
  t.after(() => closeServer(v6));
  const targets = [];
  const proxy = http.createServer();
  proxy.on('connect', (request, client, head) => {
    const target = new URL(`http://${request.url}`);
    const host = target.hostname.replace(/^\[|\]$/g, '');
    targets.push(host);
    // Never resolve fixture domains via the system or a real DNS service.
    if (!net.isIP(host)) { client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); return; }
    const connection = net.createConnection({ host, port: Number(target.port) }, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) connection.write(head);
      client.pipe(connection).pipe(client);
    });
    connection.on('error', () => client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
    client.on('error', () => connection.destroy());
    client.on('close', () => connection.destroy());
  });
  const proxyPort = await listen(proxy, { host: '127.0.0.1', port: 0 });
  t.after(() => closeServer(proxy));
  configureDns(config, local, remote);
  config.outbounds = config.outbounds.map((outbound) => {
    if (outbound.type === 'anytls') return { type: 'http', tag: outbound.tag, server: '127.0.0.1', server_port: proxyPort };
    if (outbound.type === 'urltest') return { type: 'selector', tag: outbound.tag, outbounds: outbound.outbounds };
    return outbound;
  });
  // Fixture addresses are loopback; remove only this bypass so proxy paths are exercised too.
  config.route.rules = config.route.rules.filter((rule) => !rule.ip_is_private);
  const reservation = net.createServer();
  const port = await listen(reservation, { host: '127.0.0.1', port: 0 });
  await closeServer(reservation);
  config.inbounds = [{ type: 'mixed', tag: 'tun-in', listen: '127.0.0.1', listen_port: port }];
  const logs = await startCore(t, binary, config);
  const request = async (name) => (await run('curl', ['--silent', '--show-error', '--max-time', '4', '--noproxy', '',
    '--proxy', `socks5h://127.0.0.1:${port}`, `http://${name}:${webPort}/`], { timeout: 6000 })).stdout;
  for (const name of foreignDomains) {
    assert.equal(await request(name), 'IPv4', `${name}\n${logs()}`);
  }
  assert(targets.includes('127.0.0.1'), 'foreign proxy connections must receive a resolved IPv4 destination');
  for (const name of ['domestic.test', 'domestic-v4only.test', 'unknown.test', 'unknown-v4only.test']) {
    assert.equal(await request(name), 'IPv4', `${name}: prefer IPv4 when both are reachable\n${logs()}`);
  }
  for (const name of ['domestic-v6only.test', 'unknown-v6only.test']) {
    assert.equal(await request(name), 'IPv6', `${name}: IPv6-only destinations must work\n${logs()}`);
  }
  const ipv6Request = async (name) => (await run('curl', ['--silent', '--show-error', '--max-time', '4', '--noproxy', '',
    '--proxy', `socks5h://127.0.0.1:${port}`, '-H', `Host: ${name}`, `http://[::1]:${webPort}/`], { timeout: 6000 })).stdout;
  await assert.rejects(ipv6Request('foreign-explicit.test'), 'cached IPv6 with a known foreign HTTP host must be rejected');
  await assert.rejects(ipv6Request('foreign-fallback.test'), 'cached foreign IPv6 must not escape via the default outbound');
  await assert.rejects(ipv6Request('direct-first.test'), 'a custom-direct overlap must not bypass the foreign IPv6 restriction');
  for (const name of ['claude.ai', ...hubspotDomains]) {
    await assert.rejects(ipv6Request(name), `${name}: early business routes must not bypass the foreign IPv6 restriction`);
  }
  for (const name of ['domestic.test', 'direct-local.test', 'unknown.test']) {
    assert.equal(await ipv6Request(name), 'IPv6', `${name}: IPv6 must not be globally rejected\n${logs()}`);
  }
  await assert.rejects(request('foreign-v6only.test'), 'known foreign IPv6-only targets must fail closed');
  await closeServer(v4);
  assert.equal(await request('domestic.test'), 'IPv6', `domestic IPv4 failure must fall back to IPv6\n${logs()}`);
  assert.equal(await request('unknown.test'), 'IPv6', `unknown IPv4 failure must fall back to IPv6\n${logs()}`);
  const before = targets.length;
  await assert.rejects(request('foreign-explicit.test'), 'foreign IPv4 failure must never fall back to IPv6');
  assert(targets.slice(before).every((host) => net.isIP(host) === 4), 'foreign fallback leaked an IPv6 destination');
  assert(targets.every((host) => net.isIP(host)), 'a proxy received an unresolved domain');
  assert(![...local.requests, ...remote.requests].some((query) =>
    (foreignDomains.includes(query.name) || query.name === 'foreign-v6only.test') && query.type === 28),
    'foreign AAAA queries must not reach either upstream');
};

exports.checkClashApi = async function checkClashApi(t, binary, config) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-clash-ui-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'index.html'), '<html>fixture dashboard</html>');
  const reservation = net.createServer();
  const port = await listen(reservation, { host: '127.0.0.1', port: 0 });
  await closeServer(reservation);
  await startCore(t, binary, {
    log: { level: 'info' },
    experimental: { clash_api: {
      ...config.experimental.clash_api,
      external_controller: `127.0.0.1:${port}`,
      external_ui: directory,
      secret: 'fixture-api-only',
    } },
    outbounds: [{ type: 'direct', tag: 'direct-out' }],
    route: { final: 'direct-out' },
  });
  const request = (pathname) => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname,
      headers: { Authorization: 'Bearer fixture-api-only' } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    req.setTimeout(3000, () => req.destroy(new Error('Clash API request timed out')));
    req.on('error', reject);
  });
  const version = await request('/version');
  assert.equal(version.status, 200);
  assert.match(JSON.parse(version.body).version, /1\.14/);
  const proxies = await request('/proxies');
  assert.equal(proxies.status, 200);
  assert(JSON.parse(proxies.body).proxies['direct-out']);
  const ui = await request('/ui/');
  assert.equal(ui.status, 200);
  assert.match(ui.body, /fixture dashboard/);
};
