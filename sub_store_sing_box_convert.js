const { type, name } = $arguments
const compatible_outbound = {
  tag: 'COMPATIBLE',
  type: 'direct',
}

let compatible
let config = JSON.parse($files[0])

let proxies = await produceArtifact({
  name,
  type: /^1$|col/i.test(type) ? 'collection' : 'subscription',
  platform: 'sing-box',
  produceType: 'internal',
})

config.outbounds.push(...proxies)

config.outbounds.map(i => {
  // Handle special all tags substitution
  if (i.tag === '{all}') {
    return getTags(proxies)
  }

  // Update node group mappings based on the new configuration
  if (i.outbounds && i.outbounds.includes('{all}')) {
    const index = i.outbounds.indexOf('{all}')
    i.outbounds.splice(index, 1, ...getTags(proxies))
  }

  // Handle node filtering based on the new configuration groups
  switch (i.tag) {
    case '🇭🇰 香港自动节点':
    case '🇭🇰 香港节点':
      i.outbounds.push(...getTags(proxies, /🇭🇰|HK|hk|香港|港|HongKong|Hong Kong/i))
      break
    case '🇨🇳 台湾节点':
      i.outbounds.push(...getTags(proxies, /🇹🇼|TW|tw|台湾|臺灣|台|Taiwan/i))
      break
    case '🇯🇵 日本节点':
      i.outbounds.push(...getTags(proxies, /🇯🇵|JP|jp|日本|日|Japan/i))
      break
    case '🇸🇬 狮城节点':
      i.outbounds.push(...getTags(proxies, /🇸🇬|SG|sg|新加坡|狮|Singapore/i))
      break
    case '🇺🇲 美国节点':
      i.outbounds.push(...getTags(proxies, /🇺🇸|US|us|美国|美|United States/i))
      break
    case '🇺🇳 其他节点':
      i.outbounds.push(...getTags(proxies, /^(?!.*(🇭🇰|HK|hk|香港|港|Hong Kong|🇹🇼|TW|tw|台湾|台|Taiwan|🇸🇬|SG|sg|新加坡|狮|Singapore|🇯🇵|JP|jp|日本|日|Japan|🇺🇸|US|us|美国|美))/i))
      break
    case '🎮 游戏节点':
      i.outbounds.push(...getTags(proxies, /遊戲|游戏|game|Game|GAME/i))
      break
    case '🎥 奈飞节点':
      // Only exclude traffic/expiry info nodes
      i.outbounds.push(...getTags(proxies.filter(p => !/网站|地址|剩余|过期|时间|有效|Traffic|Expire/i.test(p.tag))))
      break
    case '🇺🇳 低倍节点':
      i.outbounds.push(...getTags(proxies, /日用|🇭🇰|HK|hk|香港|香|Hong Kong/i))
      break
  }
})

// Handle empty outbound groups
config.outbounds.forEach(outbound => {
  if (Array.isArray(outbound.outbounds) && outbound.outbounds.length === 0) {
    if (!compatible) {
      config.outbounds.push(compatible_outbound)
      compatible = true
    }
    outbound.outbounds.push(compatible_outbound.tag)
  }
})

$content = JSON.stringify(config, null, 2)

function getTags(proxies, regex) {
  if (!proxies) return []
  return (regex ? proxies.filter(p => regex.test(p.tag)) : proxies).map(p => p.tag)
}
