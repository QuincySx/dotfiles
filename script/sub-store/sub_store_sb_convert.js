// https://raw.githubusercontent.com/QuincySx/dotfiles/refs/heads/metadata/script/sub-store/sub_store_sb_convert.js#type=组合订阅&name=机场

// 参数说明:
// - type: 组合订阅 或 subscription（默认 subscription）
// - name: 机场
// - url: 订阅链接（可选，有则远程获取，无则本地获取）
// - includeUnsupportedProxy: 包含官方不支持的协议 SSR（布尔值或 'true'/'false'）
// - customNodes: 自建节点 JSON 的 Base64 编码字符串（支持单个节点对象或节点数组）
// - custom: 统一打包配置的 Base64 字符串（可包含 nodes, routeExcludeAddress, excludeUid 等，彻底避免 URL 符号转义损坏）
// - routeExcludeAddress / excludeAddress: 排除路由直连的 IP/CIDR（覆盖模式）
// - appendExcludeAddress: 追加排除路由直连的 IP/CIDR（如 "10.10.1.20/32"）
// - excludeUid: 排除的用户 UID，多个逗号分隔，如 "1000"
// - bypassDomains / directDomains: 自定义直连域名后缀，如 "xethub.hf.co,in.appcenter.ms"
// - clientSubnet: DNS ECS 客户端子网 IP/网段，如 "221.130.33.60/24"
// - interfaceName: TUN 网卡名称，如 "momo" 或 "tun0"

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

// 解析统一 Base64 个性化打包配置 (custom / customConfig)
let customBundle = {};
const rawCustom = args.custom || args.customConfig || args.customSettings;
if (rawCustom) {
  const decoded = decodeBase64Safe(rawCustom);
  if (decoded) {
    try {
      customBundle = parser.parse(decoded) || {};
    } catch (e) {
      console.log(`解析 custom 配置失败: ${e.message}`);
    }
  }
}

let proxies = [];
try {
  const produceOptions = {
    name,
    type,
    platform: "sing-box",
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

// 提取自建自定义节点（支持 customNodes Base64，或从 customBundle 中读取）
let customNodeList = [];
if (Array.isArray(customBundle.nodes)) {
  customNodeList.push(...customBundle.nodes);
} else if (customBundle.node && typeof customBundle.node === "object") {
  customNodeList.push(customBundle.node);
}

const rawCustomNodes = args.customNode || args.customNodes;
if (rawCustomNodes) {
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
      console.log(`解析 customNodes 失败: ${e.message}`);
    }
  }
}

// 远程链接 customNodeUrl 容灾支持
const nodeUrl =
  args.customNodeUrl ||
  args.customNodesUrl ||
  customBundle.nodeUrl ||
  customBundle.nodesUrl;
if (nodeUrl && typeof nodeUrl === "string") {
  try {
    let res;
    if (typeof $httpClient !== "undefined") {
      res = await new Promise((resolve, reject) => {
        $httpClient.get(nodeUrl, (err, resp, body) =>
          err ? reject(err) : resolve(body),
        );
      });
    } else if (typeof ProxyUtils !== "undefined" && ProxyUtils.http) {
      res = await ProxyUtils.http.get(nodeUrl);
      res = res.body || res.data || res;
    } else if (typeof fetch !== "undefined") {
      const resp = await fetch(nodeUrl);
      res = await resp.text();
    }
    const parsed = parser.parse(res);
    if (Array.isArray(parsed)) customNodeList.push(...parsed);
    else if (parsed && typeof parsed === "object") customNodeList.push(parsed);
  } catch (e) {
    console.log(`获取 customNodeUrl 失败: ${e.message}`);
  }
}

// 将自定义节点追加到 proxies 列表中，确保后续参与 {all} 展开和 filter 分组（如 self）
if (customNodeList.length > 0) {
  proxies.push(...customNodeList);
}

const compatible_outbound = {
  tag: "COMPATIBLE",
  type: "direct",
};

let compatible = false;
config.outbounds = config.outbounds || [];
config.outbounds.push(...proxies);

// 1. 处理 TUN 入站配置 (route_exclude_address, exclude_uid, interface_name)
const rawExcludeAddresses =
  customBundle.routeExcludeAddress ||
  customBundle.excludeAddress ||
  args.appendRouteExcludeAddress ||
  args.appendExcludeAddress ||
  args.routeExcludeAddress ||
  args.excludeAddress;

let extraExcludeAddresses = [];
let appendOnly = Boolean(
  args.appendRouteExcludeAddress ||
    args.appendExcludeAddress ||
    customBundle.appendRouteExcludeAddress ||
    customBundle.appendExcludeAddress,
);

if (rawExcludeAddresses) {
  let strList = [];
  if (Array.isArray(rawExcludeAddresses)) {
    strList = rawExcludeAddresses;
  } else {
    let rawStr = String(rawExcludeAddresses);
    // 兼容 URL 解码异常：+ 可能被转为空格，或保留 %2B
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

const rawUids =
  customBundle.excludeUid !== undefined
    ? customBundle.excludeUid
    : args.excludeUid;

const extraExcludeUids =
  rawUids !== undefined && rawUids !== null && rawUids !== ""
    ? (Array.isArray(rawUids) ? rawUids : String(rawUids).split(/[,;\s]+/))
        .map((s) => parseInt(String(s).trim(), 10))
        .filter((n) => !isNaN(n))
    : [];

const activeInterfaceName = customBundle.interfaceName || args.interfaceName;

if (Array.isArray(config.inbounds)) {
  config.inbounds.forEach((inbound) => {
    if (inbound.type === "tun") {
      if (activeInterfaceName) {
        inbound.interface_name = activeInterfaceName;
      }
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
      if (extraExcludeUids.length > 0) {
        inbound.exclude_uid = Array.isArray(inbound.exclude_uid)
          ? [...new Set([...inbound.exclude_uid, ...extraExcludeUids])]
          : extraExcludeUids;
      }
    }
  });
}

// 2. 处理自定义直连域名 (bypassDomains / directDomains)
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

// 3. 处理 DNS 客户端子网 ECS (clientSubnet)
const activeClientSubnet = customBundle.clientSubnet || args.clientSubnet;
if (activeClientSubnet && config.dns && Array.isArray(config.dns.rules)) {
  config.dns.rules.forEach((rule) => {
    if (rule.client_subnet) {
      rule.client_subnet = activeClientSubnet;
    }
  });
}

// 4. 处理带有过滤规则的分组并展开 {all}
config.outbounds.forEach((outbound) => {
  if (outbound.outbounds && outbound.outbounds.includes("{all}")) {
    let filteredProxies = [...proxies];

    // Apply filters if they exist
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

    // Replace {all} with filtered proxies
    const index = outbound.outbounds.indexOf("{all}");
    outbound.outbounds.splice(index, 1, ...filteredProxies.map((p) => p.tag));

    // Deduplicate tags in outbound list to prevent sing-box validation errors
    outbound.outbounds = [...new Set(outbound.outbounds)];
  }

  // Remove the filter field after processing
  if (outbound.filter) {
    delete outbound.filter;
  }

  // Safeguard: If default outbound is specified but not found in outbounds, delete it to avoid sing-box crash
  if (
    outbound.default &&
    Array.isArray(outbound.outbounds) &&
    !outbound.outbounds.includes(outbound.default)
  ) {
    delete outbound.default;
  }
});

// 5. 处理空分组，避免 sing-box 启动报错
config.outbounds.forEach((outbound) => {
  if (Array.isArray(outbound.outbounds) && outbound.outbounds.length === 0) {
    if (!compatible) {
      config.outbounds.push(compatible_outbound);
      compatible = true;
    }
    outbound.outbounds.push(compatible_outbound.tag);
  }
});

$content = JSON.stringify(config, null, 2);
