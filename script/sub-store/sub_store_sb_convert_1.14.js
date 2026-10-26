// https://raw.githubusercontent.com/QuincySx/dotfiles/refs/heads/metadata/script/sub-store/sub_store_sb_convert_1.14.js#type=组合订阅&name=机场

// 参数说明:
// - type: 组合订阅 或 subscription（默认 subscription）
// - name: 机场
// - url: 订阅链接（可选，有则远程获取，无则本地获取）
// - includeUnsupportedProxy: 包含官方不支持的协议 SSR（布尔值或 'true'/'false'）
// - routeExcludeAddress / excludeAddress: 排除路由直连的 IP/CIDR，多个逗号分隔。默认直接覆盖，以 '+' 开头则追加到现有列表中，如 "+10.10.1.20/32"
// - excludeUid: 排除的用户 UID，多个逗号分隔，如 "1000"
// - bypassDomains / directDomains: 自定义直连域名后缀，多个逗号分隔，如 "xethub.hf.co,icloud-content.com"
// - clientSubnet: DNS ECS 客户端子网 IP/网段，如 "221.130.33.60/24"
// - interfaceName: TUN 网卡名称，如 "momo" 或 "tun0"

const args = $arguments ?? {};
const {
  name,
  url,
  includeUnsupportedProxy,
  routeExcludeAddress,
  excludeAddress,
  excludeUid,
  bypassDomains,
  directDomains,
  clientSubnet,
  interfaceName,
} = args;
let { type } = args;

type = /^1$|col|组合/i.test(type) ? "collection" : "subscription";
const isIncludeUnsupported =
  includeUnsupportedProxy === true || includeUnsupportedProxy === "true";

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

const compatible_outbound = {
  tag: "COMPATIBLE",
  type: "direct",
};

let compatible = false;
config.outbounds = config.outbounds || [];
config.outbounds.push(...proxies);

// 1. 处理 TUN 入站配置 (route_exclude_address, exclude_uid, interface_name)
const rawExcludeAddresses = routeExcludeAddress || excludeAddress;
let extraExcludeAddresses = [];
let appendOnly = false;

if (rawExcludeAddresses) {
  let str = String(rawExcludeAddresses).trim();
  if (str.startsWith("+")) {
    appendOnly = true;
    str = str.slice(1);
  }
  extraExcludeAddresses = str
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((ip) => (ip.includes("/") ? ip : `${ip}/32`));
}

const extraExcludeUids =
  excludeUid !== undefined && excludeUid !== null && excludeUid !== ""
    ? String(excludeUid)
        .split(/[,;\s]+/)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n))
    : [];

if (Array.isArray(config.inbounds)) {
  config.inbounds.forEach((inbound) => {
    if (inbound.type === "tun") {
      if (interfaceName) {
        inbound.interface_name = interfaceName;
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
const rawBypassDomains = bypassDomains || directDomains;
if (rawBypassDomains && config.route && Array.isArray(config.route.rules)) {
  const domainList = String(rawBypassDomains)
    .split(/[,;\s]+/)
    .map((d) => d.trim().toLowerCase())
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
if (clientSubnet && config.dns && Array.isArray(config.dns.rules)) {
  config.dns.rules.forEach((rule) => {
    if (rule.client_subnet) {
      rule.client_subnet = clientSubnet;
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
