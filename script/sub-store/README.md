# sing-box Sub-Store 配置转换

## 本次恢复版（目标 sing-box 1.14.4）

活动模板和转换脚本只面向 sing-box 1.14。保留既有业务出口和旁路由 TUN 参数，补齐域名分类对应的 DNS 与连接地址族策略。

### 临时 DNS 方案

- `localDns` / `resolverDns`：直连 AliDNS DoH，连接 IP `223.5.5.5`，TLS 名称 `dns.alidns.com`。
- `proxyDns`：Google DoH，连接 IP `8.8.8.8`，TLS 名称 `dns.google`，经 `🚀 手选节点`。
- 节点拨号的默认引导解析：`resolverDns`，`ipv4_only`。这不是全局禁用业务 IPv6。
- 移除后来新增的独立 `⚡ DNS 分流`，恢复版本拆分前远程 DNS 跟随手选组的出口关系。

这是为避开 UDP/53 引导和 DoQ 启动依赖而采用的**应急方案**，不是 sing-box 1.14 强制要求，也不代表已经证明旧 DoQ 不可用。域名寻址、DoQ、DNS 出口独立性等长期需求另行讨论。

## 模板与脚本配对

| 目标 | 模板 | 转换脚本 |
| --- | --- | --- |
| 1.14.4 | `sing/sing_config_template_backup_1.14.json` | `script/sub-store/sub_store_sb_convert_1.14.js` |

无版本后缀的模板和脚本是 1.14 别名。`source/` 中对应模板与 `sing/` 发布文件保持一致，回归测试检查同步。

1.13 文件保留作历史参考，不再由活动脚本输出或降级适配。活动脚本拒绝 `v=1.13`。迁移前的原始行为应从 Git 固定提交读取：`599dbd2` 为首次分版，`2e9cadc` 为其父提交；不要仅根据当前文件名判断原始行为。

### 脚本职责与个人参数

日常用法是把模板文件和自建节点文件一起加入 Sub-Store 的输入，顺序不限。节点文件可以是节点数组，或包含 `outbounds` 的对象；不需要为这个文件再配置外链或本地 HTTP 地址。

以当前 1.14 模板为唯一生成基准。固定 DNS、国内外分类、IPv4 限制和业务分流由模板维护，脚本负责读取输入、装配节点、应用个人参数、展开模板选择组。不猜测主模板，不兼容或迁移 1.13 配置，不转换旧 API、面板或缓存字段。

| 用途 | 常用参数 |
| --- | --- |
| 机场订阅 | `name`、`type`、`url` |
| 自建节点 | 输入节点文件；也可显式使用 `selfSub` / `selfSubType` |
| 可选自建来源 | `customNodes`（Base64，或 `none` / `false` 禁用）、`customNodesUrl`、`localFile` |
| 设备预设 | `profile`：`mac`、`mobile`、`router`、`router-bypass`、`router_pbr` |
| TUN 个性化 | `interfaceName`、`autoRoute`、`autoRedirect`、`strictRoute`、`excludeUid` |
| 地址排除 | `routeExcludeAddress` 覆盖，`appendRouteExcludeAddress` 追加；IPv6 请显式传入 CIDR |
| 存储与面板目录 | `storagePath`，或分别指定 `cachePath`、`externalUi` |
| 私人直连域名 | `bypassDomains` |
| DNS ECS | `clientSubnet` |
| 打包个人设置 | `custom`：Base64 JSON |

既有参数别名、优先级和清空/追加语义继续保留；`custom.appendRouteExcludeAddress` / `custom.appendExcludeAddress` 会读取其中的地址并追加。`localFile` 保留 Sub-Store 的 `read` / `getFile` 读取，以及原有 3000/3001 端口、127.0.0.1/localhost 的 HTTP 回退顺序。远程节点源保留 `$httpClient`、`ProxyUtils.http`、`fetch` 三种客户端路径。

附加 DNS、入站、路由等切片仍可合并。DNS 切片排在模板开头的固定过滤之后、普通解析规则之前，多份切片仍由后输入的优先；业务路由切片排在地址族限制及 `resolve` 之后。API、面板和缓存沿用当前模板字段，脚本仅按路径参数设置缓存文件与 Clash 面板目录。

国内常用连接的性能优先：模板和 `router-bypass` 预设保留 `route_exclude_address_set: ["geoip-cn"]`。在 Linux 的自动路由/重定向场景下，命中的国内 IP 直接绕过核心，不必先经过全局 `sniff`。不为小众域名的识别让所有国内 TCP 都进入核心。

小众域名只在 DNS 阶段增加判断：非明确国外域名由 `localDns` 执行 `evaluate`；响应命中 `geoip-cn` 时用 `respond` 直接采用这份结果，避免重复查询；否则继续 `proxyDns`。仍进入核心的连接保留原有业务顺序，末尾以“`geoip-cn` 且不属于 `geosite-geolocation-!cn`”作条件直连兜底，不再添加前置无条件 GeoIP 路由。

TUN 的国内 IP 排除早于核心业务规则：命中排除集合的连接按国内 IP 优先直连，即使域名同时出现在后面的代理业务名单里也不会再执行那些规则。核心内的业务优先级只适用于未被 TUN 排除的连接。`mac` / `mobile` 预设继续清空该排除集合。

### Momo 旁路由参数

保留原订阅名称、订阅类型、自建节点等现有参数，使用：

```text
#name=原订阅名称&profile=router-bypass&storagePath=momo&v=1.14.4
```

`storagePath=momo` 写入：

- `experimental.cache_file.path = /etc/momo/run/cache.db`
- `experimental.clash_api.external_ui = /etc/momo/run/ui`

继续使用 `experimental.clash_api` 和 MetaCubeXD。脚本保留模板的 Clash API 配置，不再自动改成 `services[type=api]`。1.14 的新 API 不是使用 Clash API 的前提。

### 流媒体与自建节点选择

YouTube、奈飞、Disney、Spotify 共用 `🎥 流媒体分流`，在此处选一次节点，四类服务一起切换。流媒体路由位于通用 Google、CDN 规则之前，避免视频、接口等域名被这些通用规则分走。YouTube 使用仓库现有的 `sing/rules/geosite/youtube.srs`，并加入国外 IPv4 限制。

流媒体组还直接列出名称匹配日本、香港、新加坡标记的所有节点，包含游戏节点，并排除流量/到期等信息条目。独立的 `🎥 奈飞节点` 组及其引用已移除，流媒体默认跟随 `🚀 手选节点`。自建节点仍全部保留，不受这三个地区的筛选限制。

各地区英文缩写按字母边界匹配，支持 `HK01`、`SG-01` 等编号，以及 HKG/JPN/SGP/TWN/USA 标记；避免将 `USGame` 中的 `SG` 当作新加坡。旗帜、中文地区名等既有标记继续保留。

手选、GPT、Claude、CDN、流媒体和漏网分组，都在列表前面直接列出每个自建节点，并保留 `🏴☠️ 自建节点` 子分组。模板用 `{self}` 表示这些位置，转换器根据实际加载的自建订阅或节点切片展开，不要求节点名称包含 `self`；同时兼容旧订阅中名称含 `self` 的节点。其他分组的原有默认出口保留。

自建节点沿用已有加载方式，例如 `#name=机场订阅名&selfSub=自建订阅名`，或传入自建节点切片。自建组的末尾依次为 `block-out`、`direct-out`；未加载自建节点时，`{self}` 展开为空，没有历史选择覆盖时默认阻断，直连仍可手动选择。正常加载时默认第一个自建节点。

同名节点全部保留：先加载的保留原名，后加载的依次加 ` 1`、` 2`，已有这些名字时继续递增，并在日志提示改名。与模板分组同名的节点也会改名，模板分组保留。机场和自建来源分别记录改名后的引用，自建分组、同来源节点链及选择组不会误指向机场同名节点。

GitHub 不再单独指定到手选节点，继续匹配微软服务等已有分流规则；CDN 分流保留。GitHub 的国外 IPv4 限制仍保留。

Google AI 接入 MetaCubeX 的 `google-deepmind.srs`，标签为 `geosite-google-ai`，与 OpenAI 一起使用 `🤖 GPT分流`。该规则在通用 Google、CDN 规则之前匹配；DNS 提前使用 `proxyDns`，并加入国外 AAAA/HTTPS/SVCB 过滤与已识别 IPv6 连接拒绝。Antigravity 的 `daily-cloudcode-pa.googleapis.com`、`cloudcode-pa.googleapis.com` 等模型接口因此跟随 GPT 选择，不再落到通用手选组。调整 GPT 组节点即可切换这些 Google AI 服务的业务出口；其他 Google 域名继续按原规则处理。

### Claude / HubSpot 提前路由

`ac-claude` 和 `hs-analytics.net`、`hs-scripts.com`、`hubspot.com` 的路由，放在 QUIC 拒绝之后、隐私/广告规则及 Clash 模式规则之前，使用 `🤖 Claude分流`。这是用户确认的优先级：即使命中后面的广告规则或切换 Clash 模式，这些域名仍先按 Claude 路由处理。

地址族限制和 `resolve` 仍在这些业务路由之前。三个 HubSpot 后缀也加入 `rules/Ac-claude-proxy.list`，并同步生成 `sing/rules/Ac-claude-proxy.json` / `.srs`，使它们沿用 Claude 的 DNS 和国外 IPv4 限制。

## DNS 迁移边界

1.14.4 中 DNS rule action 的 `strategy` 是 deprecated，不是无条件禁止；它与 `evaluate` / response matching 等新 DNS 模式有混用限制。本次不再为了绕过检查而静默删除策略：

- 配套 1.14 模板使用新 DNS 匹配方式，不含 legacy rule strategy。
- 将含 legacy strategy 的规则切片混入新模式时，转换器明确报错，避免悄悄改变解析语义。

### 地址族限制：只限制明确国外域名

- **明确国外规则**：OpenAI、Claude、代理 CDN、`geosite-geolocation-!cn` 及国外应用名单统一放入第一条 DNS 过滤规则，对 AAAA、HTTPS、SVCB 查询返回 `NOERROR` 空响应，避免 IPv6 地址和 `ipv6hint`。IPv4 不可用时失败，不回退到 IPv6。
- **其他域名**：不增加地址族限制，保留 A、AAAA 双栈。沿用现有默认 `prefer_ipv4` 和 IPv6 回退；走代理兜底不代表该域名属于“明确国外”。

经本配置处理的 DNS 查询首先执行国外 IPv6 过滤，不排除国内或自定义直连名单的重叠域名。正常 DNS 查询中，OpenAI 和 Claude 同组提前使用 `proxyDns`，不会落到后面的国内规则。后续连接先受 TUN 的国内 IP 排除处理，其余才进入核心选择业务出口。

进入核心的业务路由在 DNS 劫持之后执行 `resolve`，使用 `prefer_ipv4`，不指定 `server`，让解析继续经过上述 DNS 规则。明确国外域名因此只得到 IPv4 地址；国内和未知域名保留双栈。解析后的 IP 交给原有业务出口，避免代理节点自行重新解析目标域名并选择 IPv6。节点本身的 DNS 引导仍独立使用 `resolverDns` 的 `ipv4_only`。

模板的 `route.rules` 直接列出一条 IPv6 拒绝规则：`IPv6 AND 命中国外名单 → reject`，不含反选或嵌套例外名单。对仍进入核心的旧 IPv6 连接，若嗅探等机制能识别国外域名，则拒绝连接；已由 TUN 排除的连接不经过该规则。其他域名不会被全局禁用 IPv6。

脚本不扫描 DNS 来生成或改写地址族限制；模板包含完整的静态 DNS 与路由策略。修改国内外分类时，需要一起维护模板中的 DNS 条件与对应的 IPv6 路由限制。自定义路由切片和 `bypassDomains` 始终放在地址族限制及 `resolve` 之后，避免提前绕过这些规则。

同 revision 官方依据：

- [迁移文档](https://github.com/SagerNet/sing-box/blob/c005f35300ce76427dc285481ec5695f5b179cd2/docs/migration.md)
- [DNS rule actions](https://github.com/SagerNet/sing-box/blob/c005f35300ce76427dc285481ec5695f5b179cd2/docs/configuration/dns/rule_action.md)
- [Dial Fields](https://github.com/SagerNet/sing-box/blob/c005f35300ce76427dc285481ec5695f5b179cd2/docs/configuration/shared/dial.md)
- [路由 resolve 动作](https://github.com/SagerNet/sing-box/blob/c005f35300ce76427dc285481ec5695f5b179cd2/docs/configuration/route/rule_action.md#resolve)

## 验证

不安装依赖即可运行转换器回归测试：

```sh
node --test script/sub-store/test/sub_store_sb_convert.test.cjs
```

测试保存了精简前的固定实现 `test/fixtures/sub_store_sb_convert.before_refactor.js`，对当前模板和个人参数执行差分验证，比较配置输出、参数优先级、节点来源、HTTP/本地读取、切片顺序、错误和日志。无模板兜底及旧 API / 缓存迁移明确排除在支持范围外，不再要求保持这些旧行为。基线有固定哈希校验，不能靠同步替换基线来让重构通过。

附带真实核心检查（传入本机可执行文件）：

```sh
node script/sub-store/test/sub_store_sb_convert.test.cjs /path/to/sing-box-1.14.4
```

真实核心检查在测试机使用 `mac` 预设，旁路由参数另有结构断言；不等同于在用户 Linux 路由器上启动和联网验收。发布后，应先在路由器对 Sub-Store **生成后的完整配置**执行 `sing-box check -c <实际配置路径>`，成功后再通过 Momo 重载。

传入 1.14 核心时，还会启动仅监听本地地址的 DNS、HTTP 双栈目标和代理实例，验证国外 A 可用且 AAAA/HTTPS/SVCB 为空、国内/未知双栈可用、未知 IPv4 优先及 IPv6 回退、国外无 IPv4 时失败、已识别的国外旧 IPv6 连接被拒绝，以及交给代理的是已解析 IP。Claude/HubSpot 使用实际编译的规则集，验证其优先于重叠的广告规则。另有本地 Clash REST API 和静态面板访问检查。需要系统提供 `dig` 和 `curl`，不会访问真实 DNS 上游或外部代理。

Google AI 测试使用 `test/fixtures/google-deepmind.json`，从 MetaCubeX `meta-rules-dat` 的 `f78aeb1c01f3f7e020d9e7fcfa4f7198120a10be` 提交中 `geo/geosite/google-deepmind.srs` 解编译得到。测试通过独立的代理身份确认模型接口实际使用 GPT 选择组，并覆盖与国内、CDN 规则重叠时的优先级；生产配置继续订阅上游更新。

更新模板后需重新生成订阅、重载核心，并清理终端/浏览器缓存的旧 DNS 结果。自带 DoH 和无法识别域名的 IPv6 字面量请求无法套用域名分类；未知域名需要保留 IPv6，因此没有全局屏蔽 IPv6。

## 发布与缓存

脚本、模板与 Claude 规则集必须一起更新。规则集下载 URL 保留 `@metadata`，需要确认发布的 `.srs` 已更新，并刷新核心中的旧规则集缓存。在原订阅参数不变的前提下，优先把脚本、模板两条 URL 中的 `@metadata` 同时换为发布提交的完整 SHA，避免 CDN 和 Sub-Store 缓存旧文件。模板本身含有 `{all}` / `filter`，不是可直接启动的最终配置，仍需由 Sub-Store 转换生成。
