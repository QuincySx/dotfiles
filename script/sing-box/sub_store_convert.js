// https://raw.githubusercontent.com/QuincySx/CustomRules/refs/heads/master/sub_store_sing_box_convert.js#type=组合订阅&name=机场


// type 组合订阅
// name 机场
// url 订阅链接
// 可选参数: includeUnsupportedProxy 包含官方/商店版不支持的协议 SSR. 用法: `&includeUnsupportedProxy=true`

const { name, url, includeUnsupportedProxy } = $arguments
let { type } = $arguments

type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
let config
try {
  config = parser.parse($content ?? $files[0])
} catch (e) {
  throw new Error(`配置文件不是合法的 ${ProxyUtils.JSON5 ? 'JSON5' : 'JSON'} 格式`)
}

let proxies
if (url) {
  proxies = await produceArtifact({
    name,
    type,
    platform: 'sing-box',
    produceType: 'internal',
    produceOpts: {
      'include-unsupported-proxy': includeUnsupportedProxy,
    },
    subscription: {
      name,
      url,
      source: 'remote',
    },
  })
} else {
  proxies = await produceArtifact({
    name,
    type,
    platform: 'sing-box',
    produceType: 'internal',
    produceOpts: {
      'include-unsupported-proxy': includeUnsupportedProxy,
    },
  })
}

const compatible_outbound = {
  tag: 'COMPATIBLE',
  type: 'direct',
}

let compatible
config.outbounds.push(...proxies)

// Process outbounds with filters
config.outbounds.forEach(outbound => {
  if (outbound.outbounds && outbound.outbounds.includes('{all}')) {
    let filteredProxies = [...proxies]

    // Apply filters if they exist
    if (outbound.filter) {
      outbound.filter.forEach(filter => {
        const regex = new RegExp(filter.keywords.join('|'), 'i')
        if (filter.action === 'include') {
          filteredProxies = filteredProxies.filter(proxy => regex.test(proxy.tag))
        } else if (filter.action === 'exclude') {
          filteredProxies = filteredProxies.filter(proxy => !regex.test(proxy.tag))
        }
      })
    }

    // Replace {all} with filtered proxies
    const index = outbound.outbounds.indexOf('{all}')
    outbound.outbounds.splice(index, 1, ...filteredProxies.map(p => p.tag))
  }

  // Remove the filter field after processing
  if(outbound.filter){
    delete outbound.filter
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

function getTags(proxies) {
  return proxies?.map(p => p.tag) || []
}
