import os
import requests

# 提取 DOMAIN、DOMAIN-SUFFIX 类型的域名，不要 DOMAIN-KEYWORD 等其他的。
def allowed_domain_type(line):
    domain_type = line.split(',')[0]
    return domain_type == "DOMAIN" or domain_type == "DOMAIN-SUFFIX"

def get_fake_ip_filter_format(url):
    response = requests.get(url)
    if response.status_code == 200:
        input_text = response.text

        # 提取适用于 fake-ip-filter 的域名
        lines = input_text.strip().split('\n')
        fake_ip_filter_domains = [line.split(',')[1] for line in lines if allowed_domain_type(line)]

        # 转换为适用于 fake-ip-filter 的格式，不带空格和'-'，在域名前加上'+.'
        fake_ip_filter_format = "\n".join(["+.{}".format(domain) for domain in fake_ip_filter_domains])

        return fake_ip_filter_format
    else:
        return None

# 写文件到本地 fake_ip_filter_domains.list
def write_fake_ip_filter_format_to_file(url):    
    fake_ip_filter_format = get_fake_ip_filter_format(url)
    if fake_ip_filter_format:
        "https://raw.githubusercontent.com/vernesong/OpenClash/master/luci-app-openclash/root/etc/openclash/custom/openclash_custom_fake_filter.list"

        with open("fake_ip_filter.list", "r") as file:
            content = file.readlines()

        with open(os.path.join("metadata", "fake_ip_filter_domains.list"), "a+") as file:
            file.write(content)
            file.write(fake_ip_filter_format)
    else:
        print("Error: Unable to fetch or process the URL content.")

def write_fake_ip_filter_with_openClash():
    response = requests.get("https://raw.githubusercontent.com/vernesong/OpenClash/master/luci-app-openclash/root/etc/openclash/custom/openclash_custom_fake_filter.list")
    if response.status_code == 200:
        filepath = os.path.join("metadata", "fake_ip_filter_domains.list")
        with open(filepath, "wb") as file:
            file.write(response.content)


if __name__ == "__main__":
    url = "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list"

    os.makedirs("metadata", exist_ok=True)

    write_fake_ip_filter_with_openClash()
    write_fake_ip_filter_format_to_file(url)

