// Sub-Store Clash Template Script
// 将 ini 配置转换为 Clash 配置文件，并简化规则

// 从参数获取订阅名称
const { name } = $arguments

async function main() {
  // 解析传入的 ini 配置内容
  const iniContent = $content ?? $files[0]

  // 加载代理节点
  let clashMetaProxies = await produceArtifact({
    type: 'collection',
    name: name || '机场',
    platform: 'ClashMeta',
    produceType: 'internal'
  })

  // 解析 ini 配置中的规则集
  function parseRulesets(content) {
    const ruleProviders = {}
    const rules = []
    const lines = content.split('\n')

    for (const line of lines) {
      const trimmedLine = line.trim()
      // 跳过注释行
      if (trimmedLine.startsWith(';') || trimmedLine.startsWith('#') || !trimmedLine) {
        continue
      }
      if (trimmedLine.startsWith('ruleset=')) {
        const rulesetDef = trimmedLine.substring(8) // 移除 'ruleset='
        const [group, ruleUrl] = rulesetDef.split(',', 2)

        if (ruleUrl && ruleUrl.startsWith('http')) {
          // 处理 URL 规则集
          const providerName = ruleUrl.split('/').pop().replace(/\.(list|txt|yaml)$/, '')
          ruleProviders[providerName] = {
            type: 'http',
            behavior: 'domain',
            format: 'text',
            url: ruleUrl,
            interval: 86400
          }
          rules.push(`RULE-SET,${providerName},${group}`)
        } else if (ruleUrl && ruleUrl.startsWith('[]GEOSITE')) {
          // 处理 GEOSITE 规则
          const geosite = ruleUrl.replace('[]GEOSITE,', '')
          rules.push(`GEOSITE,${geosite},${group}`)
        } else if (ruleUrl && ruleUrl.startsWith('[]GEOIP')) {
          // 处理 GEOIP 规则
          const geoipRule = ruleUrl.replace('[]GEOIP,', '')
          if (geoipRule.includes('no-resolve')) {
            const [geoip] = geoipRule.split(',')
            rules.push(`GEOIP,${geoip},${group},no-resolve`)
          } else {
            rules.push(`GEOIP,${geoipRule},${group}`)
          }
        } else if (ruleUrl && ruleUrl.startsWith('[]FINAL')) {
          // 处理 FINAL 规则
          rules.push(`MATCH,${group}`)
        }
      }
    }

    return { ruleProviders, rules }
  }

  // 解析代理组配置
  function parseProxyGroups(content) {
    const proxyGroups = []
    const lines = content.split('\n')

    for (const line of lines) {
      const trimmedLine = line.trim()
      // 跳过注释行
      if (trimmedLine.startsWith(';') || trimmedLine.startsWith('#') || !trimmedLine) {
        continue
      }
      if (trimmedLine.startsWith('custom_proxy_group=')) {
        const groupDef = trimmedLine.substring(19) // 移除 'custom_proxy_group='
        const parts = groupDef.split('`')

        if (parts.length >= 3) {
          const groupName = parts[0]
          const groupType = parts[1]
          const groupConfig = parts[2]

          const group = {
            name: groupName,
            type: groupType
          }

          if (groupType === 'url-test' || groupType === 'fallback' || groupType === 'load-balance') {
            // url-test/fallback/load-balance 类型配置
            const configParts = parts.slice(2) // 从第3个元素开始是规则和配置
            if (configParts.length >= 2) {
              // 最后两个元素是测试URL和参数
              const testUrl = configParts[configParts.length - 2]
              const params = configParts[configParts.length - 1]

              // 前面的元素都是规则（正则表达式或节点名）
              const rules = configParts.slice(0, -2)

              group.url = testUrl

              // 解析参数：interval[,timeout][,tolerance]
              const paramParts = params.split(',')
              group.interval = parseInt(paramParts[0]) || 300
              if (paramParts.length > 1 && paramParts[1]) {
                group.timeout = parseInt(paramParts[1])
              }
              if (paramParts.length > 2 && paramParts[2]) {
                group.tolerance = parseInt(paramParts[2])
              }

              // 保存规则用于后续过滤
              group.rules = rules
            }
          } else if (groupType === 'select') {
            // select 类型配置 - 所有规则都在第3个元素开始
            const rules = parts.slice(2)
            group.rules = rules
          }

          proxyGroups.push(group)
        }
      }
    }

    return proxyGroups
  }

  // 解析配置
  const { ruleProviders, rules } = parseRulesets(iniContent)
  const proxyGroups = parseProxyGroups(iniContent)

  // 根据规则过滤代理节点到对应的分组
  function filterProxiesIntoGroups(groups, proxies) {
    groups.forEach(group => {
      if (group.rules) {
        const groupProxies = []

        group.rules.forEach(rule => {
          if (rule === '.*') {
            // .* 表示所有节点
            groupProxies.push(...proxies.map(proxy => proxy.name))
          } else if (rule.startsWith('(') && rule.endsWith(')')) {
            // 正则表达式过滤
            const regex = new RegExp(rule.slice(1, -1), 'i') // 去掉括号
            const matchedProxies = proxies.filter(proxy => regex.test(proxy.name))
            groupProxies.push(...matchedProxies.map(proxy => proxy.name))
          } else if (rule.startsWith('[]')) {
            // 引用其他策略组
            groupProxies.push(rule.slice(2))
          } else {
            // 普通节点名匹配（包含关键词）
            const matchedProxies = proxies.filter(proxy => proxy.name.includes(rule))
            groupProxies.push(...matchedProxies.map(proxy => proxy.name))
          }
        })

        // 去重并设置到代理组
        group.proxies = [...new Set(groupProxies)]

        // 清理临时字段
        delete group.rules
      }
    })

    return groups
  }

  // 过滤代理节点到对应分组
  const filteredProxyGroups = filterProxiesIntoGroups(proxyGroups, clashMetaProxies)

  const template = {
    "proxies": [

    ],

    "proxy-groups": filteredProxyGroups,

    "rule-providers": ruleProviders,

    "rules": rules
  };

  // 将代理节点添加到配置中
  if (clashMetaProxies && Array.isArray(clashMetaProxies)) {
    template.proxies = template.proxies.concat(clashMetaProxies);
  }

  return template;
}

// 导出配置
const config = await main()
$content = ProxyUtils.yaml.dump(config)