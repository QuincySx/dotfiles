// Sub-Store → 当前 sing-box 1.14 模板；固定 DNS、分流和 API 由模板维护。
// 输入：模板 + 自建节点文件（$content / $files，顺序不限）。
// 订阅：name / type / url；自建来源：selfSub、localFile、customNodes、customNodesUrl。
// 个人设置：profile、interfaceName、autoRoute、autoRedirect、strictRoute、excludeUid。
// 地址：routeExcludeAddress、appendRouteExcludeAddress、bypassDomains、clientSubnet。
// 路径：storagePath=momo 或目录；cachePath / externalUi 可分别覆盖。
// custom：Base64 JSON 个人设置；原有参数别名和优先级保留，不迁移 1.13 配置。

const args = $arguments ?? {};
const { name, url, includeUnsupportedProxy } = args;
const subscriptionType = /^1$|col|组合/i.test(args.type) ? "collection" : "subscription";
const includeUnsupported = includeUnsupportedProxy === true || includeUnsupportedProxy === "true";
const version = String(args.v || args.version || "1.14").trim();
if (!/^v?1\.14(?:\.\d+)?(?:[-+][\w.-]+)?$/.test(version)) {
  throw new Error(`不支持的目标版本: ${version}，仅支持 1.14（可带补丁版本）`);
}
const selfEnabled = ![false, "false", "none"].includes(args.nodes ?? args.customNodes);
const parser = ProxyUtils.JSON5 || JSON;
const unique = (values) => [...new Set(values)];
const firstDefined = (...values) => values.find((value) => value !== undefined);
const strings = (value) => (Array.isArray(value) ? value : String(value).split(/[,;\s]+/))
  .map((item) => String(item).trim()).filter(Boolean);
function boolean(value, fallback) {
  if ([true, "true", 1, "1"].includes(value)) return true;
  if ([false, "false", 0, "0"].includes(value)) return false;
  return fallback;
}
function decodeBase64(value) {
  if (!value) return null;
  let encoded = String(value).trim().replace(/ /g, "+").replace(/-/g, "+").replace(/_/g, "/");
  while (encoded.length % 4) encoded += "=";
  try { return Buffer.from(encoded, "base64").toString("utf8"); }
  catch (_) {
    try { return decodeURIComponent(value); }
    catch (_) { return null; }
  }
}
async function fetchRemoteText(url, timeoutMs = 3000) {
  if (!url || typeof url !== "string") return null;
  try {
    if (typeof $httpClient !== "undefined") {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout")), timeoutMs);
        $httpClient.get(url, (error, response, body) => {
          clearTimeout(timer);
          if (error || response?.status >= 400) reject(error || new Error(`HTTP ${response?.status || "error"}`));
          else resolve(body);
        });
      });
    }
    if (ProxyUtils.http) {
      const response = await ProxyUtils.http.get(url);
      if (response?.status >= 400) return null;
      return response.body || response.data || response;
    }
    if (typeof fetch !== "undefined") {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      return response.ok ? await response.text() : null;
    }
  } catch (error) {
    console.log(`[Sub-Store] 请求远端失败 (${url}): ${error.message}`);
  }
  return null;
}

// 1. 读取当前模板和附加文件。
const inputs = unique([typeof $content === "string" ? $content : "", ...(Array.isArray($files) ? $files : [])]
  .filter((value) => typeof value === "string" && value.trim()));
if (!inputs.length) throw new Error("未获取到任何配置文件内容，请检查 $content 或 $files 输入");
const parts = [];
for (const input of inputs) {
  try { parts.push(parser.parse(input)); }
  catch (error) { console.log(`[Sub-Store] 解析输入片段跳过 (非标准 JSON): ${error.message}`); }
}
const config = parts.find((part) => part && !Array.isArray(part) && Array.isArray(part.inbounds) &&
  (Array.isArray(part.route?.rules) || Array.isArray(part.dns?.rules) || Array.isArray(part.outbounds)));
if (!config) throw new Error("未找到当前 1.14 配置模板，请同时传入模板和自建节点文件");
const selfNodes = [];
// localFile 可解开 outbounds/nodes 包装；其他来源保留各自的原有格式。
function appendNodes(parsed, unwrap = false) {
  if (Array.isArray(parsed)) selfNodes.push(...parsed);
  else if (parsed && typeof parsed === "object") {
    if (unwrap && Array.isArray(parsed.outbounds)) selfNodes.push(...parsed.outbounds);
    else if (unwrap && Array.isArray(parsed.nodes)) selfNodes.push(...parsed.nodes);
    else selfNodes.push(parsed);
  }
}
function mergeTagged(target, additions) {
  const tags = new Set(target.map((item) => item.tag).filter(Boolean));
  for (const item of additions) {
    if (!item.tag || !tags.has(item.tag)) {
      target.push(item);
      if (item.tag) tags.add(item.tag);
    }
  }
}
function businessIndex(rules) {
  const resolve = rules.findIndex((rule) => rule.action === "resolve");
  if (resolve !== -1) return resolve + 1;
  const index = rules.findIndex((rule) => !["sniff", "hijack-dns"].includes(rule.action));
  return index === -1 ? rules.length : index;
}
// 模板开头的固定 DNS 过滤始终先执行；附加规则仍保持后输入者优先。
const templateDnsRules = config.dns?.rules || [];
let dnsInsertIndex = templateDnsRules.findIndex((rule) => rule.action !== "predefined");
if (dnsInsertIndex === -1) dnsInsertIndex = templateDnsRules.length;
for (const part of parts.filter((part) => part !== config)) {
  if (!part || typeof part !== "object") continue;
  if (Array.isArray(part)) {
    if (selfEnabled) appendNodes(part);
    continue;
  }
  if (selfEnabled && Array.isArray(part.outbounds)) appendNodes(part.outbounds);
  if (part.dns && typeof part.dns === "object") {
    config.dns ||= {};
    if (Array.isArray(part.dns.servers)) mergeTagged(config.dns.servers ||= [], part.dns.servers);
    if (Array.isArray(part.dns.rules)) (config.dns.rules ||= []).splice(dnsInsertIndex, 0, ...part.dns.rules);
    for (const key of ["strategy", "final", "reverse_mapping", "client_subnet"]) {
      if (part.dns[key] !== undefined) config.dns[key] = part.dns[key];
    }
  }
  if (Array.isArray(part.inbounds)) mergeTagged(config.inbounds ||= [], part.inbounds);
  if (part.route && typeof part.route === "object") {
    config.route ||= {};
    if (Array.isArray(part.route.rules)) {
      const rules = config.route.rules ||= [];
      rules.splice(businessIndex(rules), 0, ...part.route.rules);
    }
    if (Array.isArray(part.route.rule_set)) mergeTagged(config.route.rule_set ||= [], part.route.rule_set);
  }
  if (Array.isArray(part.services)) (config.services ||= []).push(...part.services);
  if (part.experimental && typeof part.experimental === "object") {
    config.experimental = Object.assign({}, config.experimental, part.experimental);
  }
}
let custom = {};
const encodedCustom = args.custom || args.customConfig || args.customSettings;
if (encodedCustom) {
  const decoded = decodeBase64(encodedCustom);
  if (decoded) {
    try { custom = parser.parse(decoded) || {}; }
    catch (error) { console.log(`[Sub-Store] 解析 custom 配置失败: ${error.message}`); }
  }
}

const profiles = {
  mac: {
    interface_name: "momo", auto_route: true, auto_redirect: false, strict_route: true,
    exclude_uid: [], route_exclude_address: [], route_exclude_address_set: [],
  },
  router: {
    interface_name: "tun0", auto_route: true, auto_redirect: true, strict_route: false,
    exclude_uid: [1000], route_exclude_address: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
  },
  "router-bypass": {
    interface_name: "momo", auto_route: true, auto_redirect: true, strict_route: true,
    exclude_uid: [1000], route_exclude_address: ["5.5.5.5/32", "10.10.1.20/32"], route_exclude_address_set: ["geoip-cn"],
  },
  router_pbr: {
    interface_name: "tun0", auto_route: false, auto_redirect: false, strict_route: false,
    exclude_uid: [1000], route_exclude_address: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
  },
  mobile: {
    interface_name: null, auto_route: true, auto_redirect: false, strict_route: true,
    exclude_uid: [], route_exclude_address: [], route_exclude_address_set: [],
  },
};
const profileKey = (args.device || args.profile || custom.device || custom.profile || "").toString().trim().toLowerCase();
const profile = profiles[profileKey] || {};

// 2. 装配机场和自建节点。来源、优先级及读取回退保持原行为。
function subscription(name, type, url) {
  return produceArtifact({
    name, type: /^1$|col|组合/i.test(type || "") ? "collection" : "subscription",
    platform: "sing-box", produceType: "internal",
    produceOpts: { "include-unsupported-proxy": includeUnsupported },
    ...(url ? { subscription: { name, url, source: "remote" } } : {}),
  });
}
let subscribed = [];
if (name || url) {
  try {
    const result = await subscription(name, subscriptionType, url);
    if (Array.isArray(result)) subscribed = result;
  } catch (error) { throw new Error(`产物生成失败: ${error.message}`); }
}
const selfSub = args.selfSub || args.selfNodes || args.selfCollection || args.customSub || custom.selfSub;
if (selfEnabled && selfSub) {
  try {
    const result = await subscription(selfSub, args.selfSubType || args.selfType);
    if (Array.isArray(result)) appendNodes(result);
  } catch (error) { console.log(`[Sub-Store] 从 Sub-Store 加载自建订阅 [${selfSub}] 失败: ${error.message}`); }
}
const localFiles = args.localFile || args.localFiles || args.customFile || args.customFiles || custom.localFile || custom.localFiles;
if (selfEnabled && localFiles) {
  for (const name of strings(localFiles)) {
    let content = null;
    try {
      if (typeof $substore !== "undefined") {
        if (typeof $substore.read === "function") content = $substore.read(name) || $substore.read(`file/${name}`);
        else if (typeof $substore.getFile === "function") content = await $substore.getFile(name);
      }
    } catch (_) {}
    if (!content) {
      for (const host of ["127.0.0.1:3001", "127.0.0.1:3000", "localhost:3001", "localhost:3000"]) {
        content = await fetchRemoteText(`http://${host}/api/file/${encodeURIComponent(name)}`, 1500);
        if (content) break;
      }
    }
    if (content) {
      try {
        appendNodes(parser.parse(content), true);
        console.log(`[Sub-Store] 成功加载本地文件 [${name}] 节点`);
      } catch (error) { console.log(`[Sub-Store] 解析本地文件 [${name}] 失败: ${error.message}`); }
    } else console.log(`[Sub-Store] 未能读取到本地文件 [${name}]`);
  }
}
if (selfEnabled && Array.isArray(custom.nodes)) appendNodes(custom.nodes);
else if (selfEnabled && custom.node && typeof custom.node === "object") selfNodes.push(custom.node);
const encodedNodes = args.customNode || args.customNodes;
if (selfEnabled && encodedNodes && !["false", "none"].includes(encodedNodes)) {
  const decoded = decodeBase64(encodedNodes);
  if (decoded) {
    try { appendNodes(parser.parse(decoded)); }
    catch (error) { console.log(`[Sub-Store] 解析 customNodes 失败: ${error.message}`); }
  }
}
const nodeURL = args.customNodeUrl || args.customNodesUrl || custom.nodeUrl || custom.nodesUrl;
if (selfEnabled && nodeURL && typeof nodeURL === "string") {
  const body = await fetchRemoteText(nodeURL, 2500);
  if (body) {
    try { appendNodes(parser.parse(body)); }
    catch (error) { console.log(`[Sub-Store] 解析远程节点池失败: ${error.message}`); }
  }
}
config.outbounds ||= [];
const templateTags = new Set();
for (const outbound of config.outbounds) {
  if (!outbound.tag || templateTags.has(outbound.tag)) throw new Error(`模板出站 tag 缺失或重复: ${outbound.tag}`);
  templateTags.add(outbound.tag);
}
const reservedTags = new Set([...templateTags, ...[...subscribed, ...selfNodes].map((node) => node?.tag)]);
const usedTags = new Set(templateTags);
const selfTags = new Set();
for (const [nodes, isSelf] of [[subscribed, false], [selfNodes, true]]) {
  const sourceTags = new Map();
  const additions = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object" || !node.tag) continue;
    let tag = node.tag;
    let suffix = 1;
    while (usedTags.has(tag) || (tag !== node.tag && reservedTags.has(tag))) tag = `${node.tag} ${suffix++}`;
    usedTags.add(tag);
    if (!sourceTags.has(node.tag)) sourceTags.set(node.tag, tag);
    if (tag !== node.tag) console.log(`[Sub-Store] 同名节点自动改名: ${node.tag} → ${tag}`);
    additions.push({ ...node, tag });
    if (isSelf) selfTags.add(tag);
  }
  // 同一来源的节点链和选择组继续指向该来源，不串到机场的同名节点。
  for (const node of additions) {
    if (Array.isArray(node.outbounds)) node.outbounds = node.outbounds.map((tag) => sourceTags.get(tag) || tag);
    for (const key of ["default", "detour"]) {
      if (sourceTags.has(node[key])) node[key] = sourceTags.get(node[key]);
    }
    config.outbounds.push(node);
  }
}
const nonProxyTypes = new Set(["selector", "urltest", "direct", "block", "dns"]);
const proxies = config.outbounds.filter((outbound) => !nonProxyTypes.has(outbound.type));
const selfProxyTags = proxies.filter((node) => selfTags.has(node.tag) || /self/i.test(node.tag)).map((node) => node.tag);

// 3. 应用个人设备、地址、目录、直连域名和 ECS 参数。
const interfaceName = firstDefined(custom.interfaceName, args.interfaceName, profile.interface_name);
const uids = firstDefined(custom.excludeUid, args.excludeUid, profile.exclude_uid);
const uidList = uids == null || uids === "" ? [] : strings(uids).map((uid) => parseInt(uid, 10)).filter((uid) => !isNaN(uid));
const rawAddresses = custom.routeExcludeAddress || custom.excludeAddress || args.appendRouteExcludeAddress ||
  args.appendExcludeAddress || custom.appendRouteExcludeAddress || custom.appendExcludeAddress ||
  args.routeExcludeAddress || args.excludeAddress || profile.route_exclude_address;
let append = Boolean(args.appendRouteExcludeAddress || args.appendExcludeAddress ||
  custom.appendRouteExcludeAddress || custom.appendExcludeAddress || profile.append_route_exclude_address);
let addressInput = rawAddresses;
if (typeof addressInput === "string" && /^(?:\+| |%2b)/i.test(addressInput)) {
  append = true;
  addressInput = addressInput.replace(/^(?:\+| |%2b)+/i, "").trim();
}
const addresses = rawAddresses ? strings(addressInput).map((ip) => ip.includes("/") ? ip : `${ip}/32`) : [];
const flags = {
  auto_route: boolean(args.autoRoute ?? args.auto_route ?? custom.auto_route, profile.auto_route),
  auto_redirect: boolean(args.autoRedirect ?? args.auto_redirect ?? custom.auto_redirect, profile.auto_redirect),
  strict_route: boolean(args.strictRoute ?? args.strict_route ?? custom.strict_route, profile.strict_route),
};
for (const inbound of config.inbounds || []) {
  if (inbound.type !== "tun") continue;
  if ([null, "", "none", "null"].includes(interfaceName)) delete inbound.interface_name;
  else if (interfaceName !== undefined) inbound.interface_name = interfaceName;
  for (const [key, value] of Object.entries(flags)) if (value !== undefined) inbound[key] = value;
  if (rawAddresses !== undefined) {
    if (append && !Array.isArray(inbound.route_exclude_address)) inbound.route_exclude_address = addresses;
    else inbound.route_exclude_address = unique([
      ...(append ? inbound.route_exclude_address : []), ...addresses,
    ]);
  }
  if (uids !== undefined) inbound.exclude_uid = uidList.length ? unique([...(inbound.exclude_uid || []), ...uidList]) : [];
  if (Array.isArray(profile.route_exclude_address_set)) inbound.route_exclude_address_set = [...profile.route_exclude_address_set];
}
const storage = args.storagePath || args.storage_path || args.storageDir || args.storage_dir || args.storePath ||
  args.storage || custom.storagePath || custom.storage;
let cachePath = args.cachePath || args.cache_path || custom.cachePath || profile.cache_path;
let externalUi = args.externalUi || args.external_ui || custom.externalUi || profile.external_ui;
if (storage) {
  let directory = String(storage).trim();
  if (["momo", "true"].includes(directory.toLowerCase())) directory = "/etc/momo/run";
  directory = directory.replace(/\/+$/, "");
  cachePath ||= `${directory}/cache.db`;
  externalUi ||= `${directory}/ui`;
}
if (cachePath) {
  config.experimental ||= {};
  config.experimental.cache_file ||= {};
  config.experimental.cache_file.path = cachePath;
}
if (externalUi && config.experimental?.clash_api) config.experimental.clash_api.external_ui = externalUi;
const rawDomains = custom.bypassDomains || custom.directDomains || args.bypassDomains || args.directDomains;
const domains = rawDomains ? strings(rawDomains).map((domain) => domain.toLowerCase()) : [];
if (domains.length && Array.isArray(config.route?.rules)) {
  config.route.rules.splice(businessIndex(config.route.rules), 0, {
    action: "bypass", outbound: "direct-out", domain_suffix: domains,
  });
}
const clientSubnet = custom.clientSubnet || args.clientSubnet;
if (clientSubnet) {
  for (const rule of config.dns?.rules || []) {
    if (rule.client_subnet !== undefined || ((rule.action || "route") === "route" && rule.server === "proxyDns")) {
      rule.client_subnet = clientSubnet;
    }
  }
}

// 4. 展开模板选择组，清理引用，保持原有空组回退和默认选择。
for (const group of config.outbounds) {
  if (Array.isArray(group.outbounds)) {
    let matched = proxies;
    if (group.outbounds.includes("{all}") && Array.isArray(group.filter)) {
      for (const filter of group.filter) {
        if (!filter.keywords?.length) continue;
        const regex = new RegExp(filter.keywords.join("|"), "i");
        if (filter.action === "include") matched = matched.filter((node) => regex.test(node.tag));
        else if (filter.action === "exclude") matched = matched.filter((node) => !regex.test(node.tag));
      }
    }
    group.outbounds = unique(group.outbounds.flatMap((tag) =>
      tag === "{self}" ? selfProxyTags : tag === "{all}" ? matched.map((node) => node.tag) : [tag]));
  }
  if (group.filter) delete group.filter;
}
const available = new Set(config.outbounds.map((outbound) => outbound.tag));
for (const group of config.outbounds) {
  if (Array.isArray(group.outbounds)) group.outbounds = group.outbounds.filter((tag) => available.has(tag));
  if (group.default && Array.isArray(group.outbounds) && !group.outbounds.includes(group.default)) delete group.default;
}
let compatible = templateTags.has("COMPATIBLE");
for (const group of [...config.outbounds]) {
  if (!Array.isArray(group.outbounds) || group.outbounds.length) continue;
  if (proxies.length) {
    group.outbounds.push(proxies[0].tag);
    console.log(`[Sub-Store] 分组 ${group.tag} 未匹配节点，回退到 ${proxies[0].tag}`);
  } else {
    if (!compatible) {
      config.outbounds.push({ tag: "COMPATIBLE", type: "direct" });
      compatible = true;
    }
    group.outbounds.push("COMPATIBLE");
  }
}
const outboundByTag = new Map(config.outbounds.map((outbound) => [outbound.tag, outbound]));
function hasProxyPath(tag, visited = new Set()) {
  if (visited.has(tag)) return false;
  const outbound = outboundByTag.get(tag);
  if (!outbound) return false;
  if (!Array.isArray(outbound.outbounds)) return !nonProxyTypes.has(outbound.type);
  const next = new Set([...visited, tag]);
  return outbound.outbounds.some((child) => hasProxyPath(child, next));
}
const manual = outboundByTag.get("🚀 手选节点");
if (manual?.default && !hasProxyPath(manual.default)) {
  const fallback = manual.outbounds.find((tag) => hasProxyPath(tag));
  if (fallback) manual.default = fallback;
}
function flattenRules(rules) {
  return rules.flatMap((rule) => [rule, ...(Array.isArray(rule.rules) ? flattenRules(rule.rules) : [])]);
}
if (Array.isArray(config.dns?.rules)) {
  const rules = flattenRules(config.dns.rules);
  const strategy = rules.some((rule) => rule.strategy !== undefined);
  const modern = rules.some((rule) => ["evaluate", "respond"].includes(rule.action) || rule.match_response ||
    rule.ip_version !== undefined || rule.query_type !== undefined || rule.preferred_by !== undefined);
  if (strategy && modern) {
    throw new Error("DNS legacy strategy 不能与 evaluate/match_response/ip_version/query_type 等新模式混用；请使用配套 1.14 模板，不要直接删除策略");
  }
}
$content = JSON.stringify(config, null, 2);
