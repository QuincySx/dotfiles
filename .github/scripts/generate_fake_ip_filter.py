import os
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from utils import (
    fetch_url_content, read_lines_from_file, ensure_directory, filter_lines
)

def allowed_domain_type(line):
    try:
        domain_type, domain = line.split(',')
        return (domain_type == "DOMAIN" or domain_type == "DOMAIN-SUFFIX") and domain != "cn"
    except:
        return False

def get_acl4ssr_china_fake_ip_filter():
    url = "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list"
    response = fetch_url_content(url)
    if response:
        lines = response.text.strip().split('\n')
        return [f"+.{line.split(',')[1]}" for line in lines if allowed_domain_type(line)]
    return []

def get_custom_fake_ip_filter():
    url = "https://raw.githubusercontent.com/QuincySx/CustomRules/metadata/rules/Ac-custom-direct.list"
    response = fetch_url_content(url)
    if response:
        lines = response.text.strip().split('\n')
        return [f"+.{line.split(',')[1]}" for line in lines if allowed_domain_type(line)]
    return []

def get_openclash_fake_ip_filter():
    url = "https://raw.githubusercontent.com/vernesong/OpenClash/master/luci-app-openclash/root/etc/openclash/custom/openclash_custom_fake_filter.list"
    response = fetch_url_content(url)
    if response:
        return [line for line in response.text.strip().split('\n')]
    return []

def read_custom_fake_ip_filter(file_path):
    lines = read_lines_from_file(file_path)
    return [line.strip() for line in lines]

def format_yaml_domain_list(domain_list):
    return [f'"{domain}"' if domain.startswith("*.") or domain.startswith("+.") else domain for domain in domain_list if not domain.startswith("#")]

def write_yaml_content(domain_list, file_path):
    format_domain_list = format_yaml_domain_list(domain_list)

    content = "fake-ip-filter:\n"
    content += "\n".join([f'  - {domain}' for domain in format_domain_list])
    with open(file_path, "w") as file:
        file.write(content)

def write_list_content(domain_list, file_path):
    content = "\n".join([f"{domain}" for domain in domain_list])
    with open(file_path, "w") as file:
        file.write(content)

def main():
    openclash_domains = get_openclash_fake_ip_filter()
    custom_domains = read_custom_fake_ip_filter(os.path.join("fakeIp", "fake_ip_filter.list"))
    chain_domains = get_acl4ssr_china_fake_ip_filter()
    custom_chain_domains = get_custom_fake_ip_filter()

    # Sanity check
    if(type(openclash_domains) != list or type(custom_domains) != list or type(chain_domains) != list):
        print("Error: one of the domain lists is not a list")
        return

    ensure_directory("metadata/clash")

    full_domains = openclash_domains + custom_chain_domains + chain_domains + custom_domains
    lite_domains = openclash_domains + custom_chain_domains + custom_domains

    write_yaml_content(full_domains, os.path.join("metadata/clash", "fake_ip_filter_domains.yaml"))

    write_list_content(full_domains, os.path.join("metadata/clash", "fake_ip_filter_domains.list"))
    write_list_content(lite_domains, os.path.join("metadata/clash", "fake_ip_filter_domains_lite.list"))


if __name__ == "__main__":
    main()
