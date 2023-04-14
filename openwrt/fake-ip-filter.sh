#!/bin/sh -e

#[ -d /etc/openclash/custom ] || mkdir /etc/openclash/custom

wget https://raw.githubusercontent.com/QuincySx/CustomRules/metadata/clash/fake_ip_filter_domains.list -O /tmp/fake_ip_filter.list.temp
mv -f /tmp/fake_ip_filter.list.temp /etc/openclash/custom/openclash_custom_fake_filter.list
