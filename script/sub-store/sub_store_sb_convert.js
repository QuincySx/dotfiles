// https://raw.githubusercontent.com/QuincySx/dotfiles/refs/heads/metadata/script/sub-store/sub_store_sb_convert.js#type=组合订阅&name=机场

// type 组合订阅
// name 机场
// url 订阅链接
// 可选参数: includeUnsupportedProxy 包含官方/商店版不支持的协议 SSR. 用法: `&includeUnsupportedProxy=true`

const args = $arguments ?? {};
const { name, url } = args;
let { type, includeUnsupportedProxy } = args;

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

// Process outbounds with filters
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

// Handle empty outbound groups
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
