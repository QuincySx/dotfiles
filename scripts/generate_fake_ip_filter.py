import os
import requests

def allowed_domain_type(line):
    try:
        domain_type, domain = line.split(',')
        return (domain_type == "DOMAIN" or domain_type == "DOMAIN-SUFFIX") and domain != "cn"
    except:
        return False

def get_fake_ip_filter_format():
    url = "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list"
    response = requests.get(url)
    if response.status_code == 200:
        lines = response.text.strip().split('\n')
        return [f"+.{line.split(',')[1]}" for line in lines if allowed_domain_type(line)]
    return []

def get_openclash_fake_ip_filter():
    url = "https://raw.githubusercontent.com/vernesong/OpenClash/master/luci-app-openclash/root/etc/openclash/custom/openclash_custom_fake_filter.list"
    response = requests.get(url)
    if response.status_code == 200:
        return [line for line in response.text.strip().split('\n')]
    return []

def read_custom_fake_ip_filter(file_path):
    with open(file_path, "r") as file:
        return [line.strip() for line in file.readlines()]

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
    custom_domains = read_custom_fake_ip_filter("fake_ip_filter.list")
    chain_domains = get_fake_ip_filter_format()
    
    # Sanity check
    if(type(openclash_domains) != list or type(custom_domains) != list or type(chain_domains) != list):
        print("Error: one of the domain lists is not a list")
        return

    os.makedirs("metadata", exist_ok=True)
 
    full_domains = openclash_domains + chain_domains + custom_domains
    lite_domains = openclash_domains + custom_domains

    write_yaml_content(full_domains, os.path.join("metadata", "fake_ip_filter_domains.yaml"))

    write_list_content(full_domains, os.path.join("metadata", "fake_ip_filter_domains.list"))
    write_list_content(lite_domains, os.path.join("metadata", "fake_ip_filter_domains_lite.list"))


if __name__ == "__main__":
    main()
