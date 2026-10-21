import os
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from utils import (
    _d, fetch_url_content, read_lines_from_file, ensure_directory, filter_lines
)

_K1 = _d("QUNMNFNTUg==")
_K2 = _d("Q2xhc2g=")
_K3 = _d("Q2hpbmFEb21haW4=")
_K4 = _d("T3BlbkNsYXNo")
_K4L = _d("b3BlbmNsYXNo")
_FIP = _d("ZmFrZV9pcA==")
_FIPF = _d("ZmFrZS1pcC1maWx0ZXI=")
_FF = _d("ZmFrZV9maWx0ZXI=")
_FIP_DIR = _d("ZmFrZUlw")

def allowed_domain_type(line):
    try:
        domain_type, domain = line.split(',')
        return (domain_type == "DOMAIN" or domain_type == "DOMAIN-SUFFIX") and domain != "cn"
    except:
        return False

def get_cn_domain_list():
    url = f"https://raw.githubusercontent.com/{_K1}/{_K1}/master/{_K2}/{_K3}.list"
    response = fetch_url_content(url)
    if response:
        lines = response.text.strip().split('\n')
        return [f"+.{line.split(',')[1]}" for line in lines if allowed_domain_type(line)]
    return []

def get_custom_list():
    local_path = "repo/rules/Ac-custom-direct.list"
    if os.path.exists(local_path):
        lines = read_lines_from_file(local_path)
        return [f"+.{line.strip().split(',')[1]}" for line in lines if allowed_domain_type(line.strip())]
    url = "https://raw.githubusercontent.com/QuincySx/dotfiles/metadata/rules/Ac-custom-direct.list"
    response = fetch_url_content(url)
    if response:
        lines = response.text.strip().split('\n')
        return [f"+.{line.split(',')[1]}" for line in lines if allowed_domain_type(line)]
    return []

def get_oc_list():
    url = f"https://raw.githubusercontent.com/vernesong/{_K4}/master/luci-app-{_K4L}/root/etc/{_K4L}/custom/{_K4L}_custom_{_FF}.list"
    response = fetch_url_content(url)
    if response:
        return [line for line in response.text.strip().split('\n')]
    return []

def read_custom_list(file_path):
    lines = read_lines_from_file(file_path)
    return [line.strip() for line in lines]

def format_yaml_domain_list(domain_list):
    return [f'"{domain}"' if domain.startswith("*.") or domain.startswith("+.") else domain for domain in domain_list if not domain.startswith("#")]

def write_yaml_content(domain_list, file_path):
    format_domain_list = format_yaml_domain_list(domain_list)

    content = f"{_FIPF}:\n"
    content += "\n".join([f'  - {domain}' for domain in format_domain_list])
    with open(file_path, "w") as file:
        file.write(content)

def write_list_content(domain_list, file_path):
    content = "\n".join([f"{domain}" for domain in domain_list])
    with open(file_path, "w") as file:
        file.write(content)

def main():
    oc_domains = get_oc_list()
    custom_domains = read_custom_list(os.path.join("repo/source", _FIP_DIR, f"{_FIP}_filter.list"))
    chain_domains = get_cn_domain_list()
    custom_chain_domains = get_custom_list()

    if(type(oc_domains) != list or type(custom_domains) != list or type(chain_domains) != list):
        print("Error: one of the domain lists is not a list")
        return

    _out = _d("ZmFrZWlw")
    _out_dir = f"repo/config/{_out}"
    ensure_directory(_out_dir)

    full_domains = oc_domains + custom_chain_domains + chain_domains + custom_domains
    lite_domains = oc_domains + custom_chain_domains + custom_domains

    write_yaml_content(full_domains, os.path.join(_out_dir, f"{_FIP}_filter_domains.yaml"))

    write_list_content(full_domains, os.path.join(_out_dir, f"{_FIP}_filter_domains.list"))
    write_list_content(lite_domains, os.path.join(_out_dir, f"{_FIP}_filter_domains_lite.list"))


if __name__ == "__main__":
    main()
