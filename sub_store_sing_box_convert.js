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
