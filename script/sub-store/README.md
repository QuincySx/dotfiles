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

### Momo 旁路由参数

保留原订阅名称、订阅类型、自建节点等现有参数，使用：

```text
#name=原订阅名称&profile=router-bypass&storagePath=momo&v=1.14.4
```

`storagePath=momo` 写入：

- `experimental.cache_file.path = /etc/momo/run/cache.db`
- `experimental.clash_api.external_ui = /etc/momo/run/ui`

继续使用 `experimental.clash_api` 和 MetaCubeXD。脚本保留模板的 Clash API 配置，不再自动改成 `services[type=api]`。1.14 的新 API 不是使用 Clash API 的前提。

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

国外 IPv6 限制最先执行，不再排除国内或自定义直连例外：同时命中国外名单和直连名单的域名，也只能使用 IPv4。正常 DNS 查询中，OpenAI 和 Claude 同组提前使用 `proxyDns`，不会落到后面的国内规则。业务出口仍由原有分流规则选择。

业务路由在 DNS 劫持之后执行 `resolve`，使用 `prefer_ipv4`，不指定 `server`，让解析继续经过上述 DNS 规则。明确国外域名因此只得到 IPv4 地址；国内和未知域名保留双栈。解析后的 IP 交给原有业务出口，避免代理节点自行重新解析目标域名并选择 IPv6。节点本身的 DNS 引导仍独立使用 `resolverDns` 的 `ipv4_only`。

模板的 `route.rules` 直接列出一条 IPv6 拒绝规则：`IPv6 AND 命中国外名单 → reject`，不含反选或嵌套例外名单。终端使用旧 IPv6 缓存时，若嗅探等机制仍能识别国外域名，则拒绝该连接。其他域名不会被全局禁用 IPv6。

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

附带真实核心检查（传入本机可执行文件）：

```sh
node script/sub-store/test/sub_store_sb_convert.test.cjs /path/to/sing-box-1.14.4
```

真实核心检查在测试机使用 `mac` 预设，旁路由参数另有结构断言；不等同于在用户 Linux 路由器上启动和联网验收。发布后，应先在路由器对 Sub-Store **生成后的完整配置**执行 `sing-box check -c <实际配置路径>`，成功后再通过 Momo 重载。

传入 1.14 核心时，还会启动仅监听本地地址的 DNS、HTTP 双栈目标和代理实例，验证国外 A 可用且 AAAA/HTTPS/SVCB 为空、国内/未知双栈可用、未知 IPv4 优先及 IPv6 回退、国外无 IPv4 时失败、已识别的国外旧 IPv6 连接被拒绝，以及交给代理的是已解析 IP。Claude/HubSpot 使用实际编译的规则集，验证其优先于重叠的广告规则。另有本地 Clash REST API 和静态面板访问检查。需要系统提供 `dig` 和 `curl`，不会访问真实 DNS 上游或外部代理。

更新模板后需重新生成订阅、重载核心，并清理终端/浏览器缓存的旧 DNS 结果。自带 DoH 和无法识别域名的 IPv6 字面量请求无法套用域名分类；未知域名需要保留 IPv6，因此没有全局屏蔽 IPv6。

## 发布与缓存

脚本、模板与 Claude 规则集必须一起更新。规则集下载 URL 保留 `@metadata`，需要确认发布的 `.srs` 已更新，并刷新核心中的旧规则集缓存。在原订阅参数不变的前提下，优先把脚本、模板两条 URL 中的 `@metadata` 同时换为发布提交的完整 SHA，避免 CDN 和 Sub-Store 缓存旧文件。模板本身含有 `{all}` / `filter`，不是可直接启动的最终配置，仍需由 Sub-Store 转换生成。
