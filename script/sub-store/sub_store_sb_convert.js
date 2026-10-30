// https://raw.githubusercontent.com/QuincySx/dotfiles/refs/heads/metadata/script/sub-store/sub_store_sb_convert.js#name=机场&device=mac
//
// 现代 SB 订阅编译脚本 (支持 1.14 现代语法 & 1.13 自动降级转译)
//
// 参数说明:
// - name: 机场名称（必填）
// - type: 组合订阅 (collection) 或 subscription（默认 subscription）
// - url: 订阅链接（可选，有则远程获取，无则从本地 Sub-Store 节点池读取）
// - device / profile: 设备预设（如 mac, router, router_pbr, mobile）
// - autoRoute / auto_route: 强制指定 TUN auto_route (true / false)
// - autoRedirect / auto_redirect: 强制指定 TUN auto_redirect (true / false)
// - strictRoute / strict_route: 强制指定 TUN strict_route (true / false)
// - interfaceName: TUN 网卡名称（如 "momo", "tun0", 设为 "none" 或 "null" 则清除）
// - excludeUid: 排除的用户 UID（如 "1000"，多个逗号分隔）
// - routeExcludeAddress / excludeAddress: 排除直连 CIDR（覆盖模式）
// - appendRouteExcludeAddress / appendExcludeAddress: 追加排除直连 CIDR
// - bypassDomains / directDomains: 自定义直连域名（如 "xethub.hf.co,in.appcenter.ms"）
// - clientSubnet: DNS ECS 客户端子网 IP/网段（如 "221.130.33.60/24"）
// - nodes / customNodes: 自建节点控制（"none" 或 "false" 则不加载外部自建节点）
// - customNodesUrl / customNodeUrl: 外部自建节点 JSON 的 URL（支持异步拉取）
// - custom: 统一打包配置的 Base64 字符串（旧版兼容支持）
// - v / version: 目标内核版本，默认 1.14。传 "1.13" 时自动执行 AST 语法降级转译
// - includeUnsupportedProxy: 是否包含 SSR 等非官方协议 (true / false)

const args = $arguments ?? {};
const { name, url, includeUnsupportedProxy } = args;
let { type } = args;

type = /^1$|col|组合/i.test(type) ? "collection" : "subscription";
const isIncludeUnsupported =
  includeUnsupportedProxy === true || includeUnsupportedProxy === "true";

// 安全 Base64 解码函数（防 URL 传输过程中 + 变空格、漏补等号、URL-safe 符号转义）
function decodeBase64Safe(str) {
  if (!str) return null;
  let clean = String(str).trim().replace(/ /g, "+");
  clean = clean.replace(/-/g, "+").replace(/_/g, "/");
  while (clean.length % 4) clean += "=";
  try {
    return Buffer.from(clean, "base64").toString("utf8");
  } catch (e) {
    try {
      return decodeURIComponent(str);
    } catch (_) {
      return null;
    }
  }
}

// 统一异步 HTTP GET 工具
async function fetchRemoteText(requestUrl, timeoutMs = 3000) {
  if (!requestUrl || typeof requestUrl !== "string") return null;
  try {
    if (typeof $httpClient !== "undefined") {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout")), timeoutMs);
        $httpClient.get(requestUrl, (err, resp, body) => {
          clearTimeout(timer);
          if (err || (resp && resp.status >= 400)) {
            reject(err || new Error(`HTTP ${resp?.status || "error"}`));
          } else {
            resolve(body);
          }
        });
      });
    } else if (typeof ProxyUtils !== "undefined" && ProxyUtils.http) {
      const res = await ProxyUtils.http.get(requestUrl);
      if (res && res.status && res.status >= 400) return null;
      return res.body || res.data || res;
    } else if (typeof fetch !== "undefined") {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(requestUrl, { signal: controller.signal });
      clearTimeout(id);
      if (!resp.ok) return null;
      return await resp.text();
    }
  } catch (e) {
    console.log(`[Sub-Store] 请求远端失败 (${requestUrl}): ${e.message}`);
  }
  return null;
}

const parser = ProxyUtils.JSON5 || JSON;
let config;
try {
  const rawContent = $content || $files?.[0];
  if (!rawContent) {
    throw new Error("未获取到配置文件内容");
  }
  config = parser.parse(rawContent);
} catch (e) {
  throw new Error(
    `配置文件不是合法的 ${ProxyUtils.JSON5 ? "JSON5" : "JSON"} 格式: ${e.message}`,
  );
}

// 1. 解析统一 Base64 个性化打包配置 (custom / customConfig / customSettings)
let customBundle = {};
const rawCustom = args.custom || args.customConfig || args.customSettings;
if (rawCustom) {
  const decoded = decodeBase64Safe(rawCustom);
  if (decoded) {
    try {
      customBundle = parser.parse(decoded) || {};
    } catch (e) {
      console.log(`[Sub-Store] 解析 custom 配置失败: ${e.message}`);
    }
  }
}

// 2. 内置设备预设库 (具备本地保底与远程更新能力)
const BUILTIN_PROFILES = {
  mac: {
    interface_name: "momo",
    auto_route: true,
    strict_route: true,
  },
  router: {
    interface_name: "tun0",
    auto_route: true,
    auto_redirect: true,
    strict_route: false,
    exclude_uid: [1000],
    route_exclude_address: [
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
    ],
  },
  router_pbr: {
    interface_name: "tun0",
    auto_route: false,
    auto_redirect: false,
    strict_route: false,
    exclude_uid: [1000],
    route_exclude_address: [
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
    ],
  },
  mobile: {
    interface_name: null,
    auto_route: true,
    strict_route: true,
  },
};

const profileAliasMap = {
  mac: "mac",
  darwin: "mac",
  osx: "mac",
  router: "router",
  openwrt: "router",
  router_tun: "router",
  router_pbr: "router_pbr",
  pbr: "router_pbr",
  tproxy: "router_pbr",
  router_no_autoroute: "router_pbr",
  mobile: "mobile",
  ios: "mobile",
  android: "mobile",
  phone: "mobile",
};

const requestedProfileKey = (
  args.device ||
  args.profile ||
  customBundle.device ||
  customBundle.profile ||
  ""
)
  .toString()
  .trim()
  .toLowerCase();

let activeProfile = {};
if (requestedProfileKey) {
  const normalizedKey = profileAliasMap[requestedProfileKey] || requestedProfileKey;
  activeProfile = BUILTIN_PROFILES[normalizedKey] || {};
}

// 3. 生成节点产物 (以仓库名作为 XOR 密钥混淆解析 target platform)
const _k = "dotfiles";
const _targetPlatform = [23, 6, 26, 1, 68, 14, 10, 11]
  .map((c, i) => String.fromCharCode(c ^ _k.charCodeAt(i % _k.length)))
  .join("");

let proxies = [];
try {
  const produceOptions = {
    name,
    type,
    platform: _targetPlatform,
    produceType: "internal",
    produceOpts: {
      "include-unsupported-proxy": isIncludeUnsupported,
    },
    ...(url ? { subscription: { name, url, source: "remote" } } : {}),
  };
  const result = await produceArtifact(produceOptions);
  proxies = Array.isArray(result) ? result : [];
} catch (e) {
  throw new Error(`产物生成失败: ${e.message}`);
}

// 4. 加载自建节点池 (支持 Base64、远端节点池、customNodesUrl)
let customNodeList = [];

// (1) 从 customBundle 中读取
if (Array.isArray(customBundle.nodes)) {
  customNodeList.push(...customBundle.nodes);
} else if (customBundle.node && typeof customBundle.node === "object") {
  customNodeList.push(customBundle.node);
}

// (2) 从 args.customNodes / customNode Base64 读取
const rawCustomNodes = args.customNode || args.customNodes;
if (rawCustomNodes && rawCustomNodes !== "false" && rawCustomNodes !== "none") {
  const decoded = decodeBase64Safe(rawCustomNodes);
  if (decoded) {
    try {
      const parsed = parser.parse(decoded);
      if (Array.isArray(parsed)) {
        customNodeList.push(...parsed);
      } else if (parsed && typeof parsed === "object") {
        customNodeList.push(parsed);
      }
    } catch (e) {
      console.log(`[Sub-Store] 解析 customNodes 失败: ${e.message}`);
    }
  }
}

// (3) 从远端加载 (默认或由 customNodesUrl 指定)
const nodesControl = (args.nodes || customBundle.nodesControl || "").toString().toLowerCase();
const shouldSkipRemoteNodes = nodesControl === "none" || rawCustomNodes === "false";
const remoteNodeUrl =
  args.customNodeUrl ||
  args.customNodesUrl ||
  customBundle.nodeUrl ||
  customBundle.nodesUrl ||
  (shouldSkipRemoteNodes
    ? null
    : "https://testingcf.jsdelivr.net/gh/QuincySx/dotfiles@metadata/source/custom_nodes.json");

if (remoteNodeUrl && typeof remoteNodeUrl === "string") {
  const fetchedBody = await fetchRemoteText(remoteNodeUrl, 2500);
  if (fetchedBody) {
    try {
      const parsed = parser.parse(fetchedBody);
      if (Array.isArray(parsed)) {
        customNodeList.push(...parsed);
      } else if (parsed && typeof parsed === "object") {
        customNodeList.push(parsed);
      }
    } catch (e) {
      console.log(`[Sub-Store] 解析远程节点池失败: ${e.message}`);
    }
  }
}

// 去重自建节点（按 tag 唯一化）
const existingProxyTags = new Set(proxies.map((p) => p.tag));
const validCustomNodes = [];
for (const node of customNodeList) {
  if (node && typeof node === "object" && node.tag) {
    if (!existingProxyTags.has(node.tag)) {
      existingProxyTags.add(node.tag);
      validCustomNodes.push(node);
    }
  }
}

if (validCustomNodes.length > 0) {
  proxies.push(...validCustomNodes);
}

const compatible_outbound = {
  tag: "COMPATIBLE",
  type: "direct",
};

let compatible = false;
config.outbounds = config.outbounds || [];
config.outbounds.push(...proxies);

// 5. 处理 TUN 入站配置 (网卡名称、auto_route、auto_redirect、strict_route、exclude_uid、CIDR 排除)
// 路由排除地址解析
const rawExcludeAddresses =
  customBundle.routeExcludeAddress ||
  customBundle.excludeAddress ||
  args.appendRouteExcludeAddress ||
  args.appendExcludeAddress ||
  args.routeExcludeAddress ||
  args.excludeAddress ||
  activeProfile.route_exclude_address;

let extraExcludeAddresses = [];
let appendOnly = Boolean(
  args.appendRouteExcludeAddress ||
    args.appendExcludeAddress ||
    customBundle.appendRouteExcludeAddress ||
    customBundle.appendExcludeAddress ||
    activeProfile.append_route_exclude_address,
);

if (rawExcludeAddresses) {
  let strList = [];
  if (Array.isArray(rawExcludeAddresses)) {
    strList = rawExcludeAddresses;
  } else {
    let rawStr = String(rawExcludeAddresses);
    if (
      rawStr.startsWith("+") ||
      rawStr.startsWith(" ") ||
      rawStr.startsWith("%2B") ||
      rawStr.startsWith("%2b")
    ) {
      appendOnly = true;
      rawStr = rawStr.replace(/^(\+| |%2B|%2b)+/i, "").trim();
    }
    strList = rawStr.split(/[,;\s]+/).filter(Boolean);
  }

  extraExcludeAddresses = strList
    .map((s) => String(s).trim())
    .filter(Boolean)
    .map((ip) => (ip.includes("/") ? ip : `${ip}/32`));
}

// 排除 UID
const rawUids =
  customBundle.excludeUid !== undefined
    ? customBundle.excludeUid
    : args.excludeUid !== undefined
      ? args.excludeUid
      : activeProfile.exclude_uid;

const extraExcludeUids =
  rawUids !== undefined && rawUids !== null && rawUids !== ""
    ? (Array.isArray(rawUids) ? rawUids : String(rawUids).split(/[,;\s]+/))
        .map((s) => parseInt(String(s).trim(), 10))
        .filter((n) => !isNaN(n))
    : [];

// 网卡名称
const activeInterfaceName =
  customBundle.interfaceName !== undefined
    ? customBundle.interfaceName
    : args.interfaceName !== undefined
      ? args.interfaceName
      : activeProfile.interface_name;

// auto_route / auto_redirect / strict_route
function parseBooleanOpt(val, fallback) {
  if (val === undefined || val === null) return fallback;
  if (val === true || val === "true" || val === 1 || val === "1") return true;
  if (val === false || val === "false" || val === 0 || val === "0") return false;
  return fallback;
}

const activeAutoRoute = parseBooleanOpt(
  args.autoRoute ?? args.auto_route ?? customBundle.auto_route,
  activeProfile.auto_route,
);

const activeAutoRedirect = parseBooleanOpt(
  args.autoRedirect ?? args.auto_redirect ?? customBundle.auto_redirect,
  activeProfile.auto_redirect,
);

const activeStrictRoute = parseBooleanOpt(
  args.strictRoute ?? args.strict_route ?? customBundle.strict_route,
  activeProfile.strict_route,
);

if (Array.isArray(config.inbounds)) {
  config.inbounds.forEach((inbound) => {
    if (inbound.type === "tun") {
      // 网卡名设置
      if (
        activeInterfaceName === null ||
        activeInterfaceName === "" ||
        activeInterfaceName === "none" ||
        activeInterfaceName === "null"
      ) {
        delete inbound.interface_name;
      } else if (activeInterfaceName !== undefined) {
        inbound.interface_name = activeInterfaceName;
      }

      // 路由行为控制
      if (activeAutoRoute !== undefined) {
        inbound.auto_route = activeAutoRoute;
      }
      if (activeAutoRedirect !== undefined) {
        inbound.auto_redirect = activeAutoRedirect;
      }
      if (activeStrictRoute !== undefined) {
        inbound.strict_route = activeStrictRoute;
      }

      // 路由地址排除
      if (extraExcludeAddresses.length > 0) {
        if (appendOnly) {
          inbound.route_exclude_address = Array.isArray(
            inbound.route_exclude_address,
          )
            ? [
                ...new Set([
                  ...inbound.route_exclude_address,
                  ...extraExcludeAddresses,
                ]),
              ]
            : extraExcludeAddresses;
        } else {
          inbound.route_exclude_address = [
            ...new Set(extraExcludeAddresses),
          ];
        }
      }

      // UID 排除
      if (extraExcludeUids.length > 0) {
        inbound.exclude_uid = Array.isArray(inbound.exclude_uid)
          ? [...new Set([...inbound.exclude_uid, ...extraExcludeUids])]
          : extraExcludeUids;
      }
    }
  });
}

// 6. 处理自定义直连域名 (bypassDomains / directDomains)
const rawBypassDomains =
  customBundle.bypassDomains ||
  customBundle.directDomains ||
  args.bypassDomains ||
  args.directDomains;

if (rawBypassDomains && config.route && Array.isArray(config.route.rules)) {
  const domainList = (
    Array.isArray(rawBypassDomains)
      ? rawBypassDomains
      : String(rawBypassDomains).split(/[,;\s]+/)
  )
    .map((d) => String(d).trim().toLowerCase())
    .filter(Boolean);

  if (domainList.length > 0) {
    const insertIdx = config.route.rules.findIndex(
      (r) => r.action !== "sniff" && r.action !== "hijack-dns",
    );
    const bypassRule = {
      action: "bypass",
      outbound: "direct-out",
      domain_suffix: domainList,
    };
    if (insertIdx !== -1) {
      config.route.rules.splice(insertIdx, 0, bypassRule);
    } else {
      config.route.rules.unshift(bypassRule);
    }
  }
}

// 7. 处理 DNS 客户端子网 ECS (clientSubnet)
const activeClientSubnet = customBundle.clientSubnet || args.clientSubnet;
if (activeClientSubnet && config.dns && Array.isArray(config.dns.rules)) {
  config.dns.rules.forEach((rule) => {
    if (rule.client_subnet) {
      rule.client_subnet = activeClientSubnet;
    }
  });
}

// 8. 处理带有过滤规则的分组并展开 {all}
config.outbounds.forEach((outbound) => {
  if (outbound.outbounds && outbound.outbounds.includes("{all}")) {
    let filteredProxies = [...proxies];

    // 应用过滤器
    if (Array.isArray(outbound.filter)) {
      outbound.filter.forEach((filter) => {
        if (!filter.keywords || !filter.keywords.length) return;
        const regex = new RegExp(filter.keywords.join("|"), "i");
        if (filter.action === "include") {
          filteredProxies = filteredProxies.filter((proxy) =>
            regex.test(proxy.tag),
          );
        } else if (filter.action === "exclude") {
          filteredProxies = filteredProxies.filter(
            (proxy) => !regex.test(proxy.tag),
          );
        }
      });
    }

    // 展开 {all}
    const index = outbound.outbounds.indexOf("{all}");
    outbound.outbounds.splice(index, 1, ...filteredProxies.map((p) => p.tag));

    // 去重
    outbound.outbounds = [...new Set(outbound.outbounds)];
  }

  if (outbound.filter) {
    delete outbound.filter;
  }
});

// 9. 清理不存在的出站引用，防止 SB 核心启动报错 "outbound not found"
const allAvailableOutboundTags = new Set(config.outbounds.map((o) => o.tag));
allAvailableOutboundTags.add("COMPATIBLE");

config.outbounds.forEach((outbound) => {
  if (Array.isArray(outbound.outbounds)) {
    outbound.outbounds = outbound.outbounds.filter((tag) =>
      allAvailableOutboundTags.has(tag),
    );
  }

  if (
    outbound.default &&
    Array.isArray(outbound.outbounds) &&
    !outbound.outbounds.includes(outbound.default)
  ) {
    delete outbound.default;
  }
});

// 10. 处理空分组，保底注入 COMPATIBLE
config.outbounds.forEach((outbound) => {
  if (Array.isArray(outbound.outbounds) && outbound.outbounds.length === 0) {
    if (!compatible) {
      config.outbounds.push(compatible_outbound);
      compatible = true;
    }
    outbound.outbounds.push(compatible_outbound.tag);
  }
});

// 11. SB 1.14 ➔ 1.13 AST 实时降级转译器
function transpile114To113(cfg) {
  // 11.1 将 services 中的 api 转回 experimental.clash_api
  if (Array.isArray(cfg.services)) {
    const apiService = cfg.services.find((s) => s.type === "api");
    if (apiService) {
      cfg.experimental = cfg.experimental || {};
      cfg.experimental.clash_api = {
        external_controller: apiService.listen || "0.0.0.0:9090",
        external_ui: "ui",
        secret: apiService.secret || "123456",
        external_ui_download_url:
          apiService.dashboard?.download_url ||
          "https://edgeone.gh-proxy.com/github.com/MetaCubeX/metacubexd/archive/gh-pages.zip",
        external_ui_download_detour: "direct-out",
        default_mode: "rule",
      };
    }
    delete cfg.services;
  }

  // 11.2 缓存配置兼容: store_dns 降级为 store_rdrc
  if (cfg.experimental?.cache_file?.store_dns !== undefined) {
    cfg.experimental.cache_file.store_rdrc = cfg.experimental.cache_file.store_dns;
    delete cfg.experimental.cache_file.store_dns;
  }

  // 11.3 DNS 规则降级: 1.14 preferred_by 与 evaluate 语法转为 1.13 语法
  if (cfg.dns && Array.isArray(cfg.dns.rules)) {
    const newDnsRules = [];
    for (let i = 0; i < cfg.dns.rules.length; i++) {
      const rule = cfg.dns.rules[i];

      // preferred_by: hosts -> ip_accept_any
      if (rule.preferred_by === "hosts") {
        newDnsRules.push({
          ip_accept_any: true,
          server: "hosts",
        });
        continue;
      }

      // evaluate + match_response 组合降级为 1.13 logical "and" 规则
      if (
        rule.action === "evaluate" &&
        rule.rule_set === "geosite-geolocation-!cn" &&
        rule.invert === true
      ) {
        const nextRule = cfg.dns.rules[i + 1];
        if (nextRule && nextRule.rule_set === "geoip-cn" && nextRule.match_response) {
          newDnsRules.push({
            type: "logical",
            mode: "and",
            rules: [
              {
                rule_set: "geosite-geolocation-!cn",
                invert: true,
              },
              {
                rule_set: "geoip-cn",
              },
            ],
            server: nextRule.server || "localDns",
            strategy: nextRule.strategy || "ipv4_only",
          });
          i++; // 跳过匹配的下一条
          continue;
        }
      }

      newDnsRules.push(rule);
    }
    cfg.dns.rules = newDnsRules;
  }

  // 11.4 路由与 http_clients 降级: 移除 http_clients 与 default_http_client，确保各规则集携带 download_detour
  if (cfg.http_clients) {
    delete cfg.http_clients;
  }
  if (cfg.route) {
    if (cfg.route.default_http_client) {
      delete cfg.route.default_http_client;
    }
    if (Array.isArray(cfg.route.rule_set)) {
      cfg.route.rule_set.forEach((rs) => {
        if (!rs.download_detour) {
          rs.download_detour = "direct-out";
        }
      });
    }
  }

  return cfg;
}

const targetVersion = (args.v || args.version || "").toString().trim();
if (targetVersion === "1.13" || targetVersion === "1.13.0") {
  config = transpile114To113(config);
}

$content = JSON.stringify(config, null, 2);
