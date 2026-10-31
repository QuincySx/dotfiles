# sing-box Sub-Store 配置转换

## 本次恢复版（目标 sing-box 1.14.4）

优先恢复服务，不重做既有业务分流。`route.rules` 和模板中的旁路由 TUN 参数保持本次修复前的设置；后续再结合 Git 历史讨论长期策略。

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
| 1.13.x | `sing/sing_config_template_backup_1.13.json` | `script/sub-store/sub_store_sb_convert_1.13.js` |

无版本后缀的模板和脚本是 1.14 别名。`source/` 中对应模板与 `sing/` 发布文件保持一致，回归测试检查同步。

1.13 文件是当前维护的兼容模板，**不是不可变的历史备份**。原始 1.13 行为应从 Git 固定提交读取：`599dbd2` 为首次分版，`2e9cadc` 为其父提交；不要仅根据文件名判断是否回滚到了旧策略。

### Momo 旁路由参数

保留原订阅名称、订阅类型、自建节点等现有参数，使用：

```text
#name=原订阅名称&profile=router-bypass&storagePath=momo&v=1.14.4
```

`storagePath=momo` 写入：

- `experimental.cache_file.path = /etc/momo/run/cache.db`
- `services[type=api].dashboard.path = /etc/momo/run/ui`

面板路径字段是 `path`，不是 `directory`。API 服务属于 1.14 新 API，不能把旧 Clash 面板兼容性等同于核心配置可启动。

## DNS 迁移边界

1.14.4 中 DNS rule action 的 `strategy` 是 deprecated，不是无条件禁止；它与 `evaluate` / response matching 等新 DNS 模式有混用限制。本次不再为了绕过检查而静默删除策略：

- 配套 1.14 模板使用新 DNS 匹配方式，不含 legacy rule strategy。
- 1.13 模板保留该版本的规则策略。
- 将含 legacy strategy 的规则切片混入新模式时，转换器明确报错，避免悄悄改变解析语义。

不承诺对任意第三方 DNS 切片做完整、无损的 AST 升降级；使用配套版本模板最稳妥。

同 revision 官方依据：

- [迁移文档](https://github.com/SagerNet/sing-box/blob/c005f35300ce76427dc285481ec5695f5b179cd2/docs/migration.md)
- [DNS rule actions](https://github.com/SagerNet/sing-box/blob/c005f35300ce76427dc285481ec5695f5b179cd2/docs/configuration/dns/rule_action.md)
- [Dial Fields](https://github.com/SagerNet/sing-box/blob/c005f35300ce76427dc285481ec5695f5b179cd2/docs/configuration/shared/dial.md)
- [API / dashboard.path](https://github.com/SagerNet/sing-box/blob/c005f35300ce76427dc285481ec5695f5b179cd2/docs/configuration/service/api.md)

## 验证

不安装依赖即可运行转换器回归测试：

```sh
node --test script/sub-store/test/sub_store_sb_convert.test.cjs
```

附带真实核心检查（传入本机可执行文件）：

```sh
node script/sub-store/test/sub_store_sb_convert.test.cjs /path/to/sing-box-1.14.4 /path/to/sing-box-1.13.12
```

真实核心检查在测试机使用 `mac` 预设，旁路由参数另有结构断言；不等同于在用户 Linux 路由器上启动和联网验收。发布后，应先在路由器对 Sub-Store **生成后的完整配置**执行 `sing-box check -c <实际配置路径>`，成功后再通过 Momo 重载。

## 发布与缓存

脚本与模板必须一起更新。在原订阅参数不变的前提下，优先把两条 URL 中的 `@metadata` 同时换为发布提交的完整 SHA，避免 CDN 和 Sub-Store 缓存旧文件。模板本身含有 `{all}` / `filter`，不是可直接启动的最终配置，仍需由 Sub-Store 转换生成。
