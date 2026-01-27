import re
import sys
import os
import yaml

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from utils import (
    read_lines_from_file, ensure_directory, fetch_url_content,
    write_lines_to_file, save_json_to_file, run_command,
    get_base_name_and_extension
)
from parse_sing_online_full import download_convert_bin, process_json_to_srs, convert_list_to_json

PREFIX = "Bak-"


def parse_yaml_backup_ini(ini_path):
    """解析 yaml_backup.ini 文件，返回 {名称: URL} 字典"""
    lines = read_lines_from_file(ini_path)
    rules = {}

    in_yaml_rules_section = False
    for line in lines:
        line = line.strip()

        if line == '[yaml_rules]':
            in_yaml_rules_section = True
            continue

        if line.startswith('[') and line.endswith(']'):
            in_yaml_rules_section = False
            continue

        if not in_yaml_rules_section:
            continue

        if not line or line.startswith('#'):
            continue

        if '=' in line:
            name, url = line.split('=', 1)
            name = name.strip()
            url = url.strip()
            if name and url:
                rules[name] = url

    return rules


def convert_yaml_payload_to_list(yaml_content):
    """将 YAML payload 格式转换为 list 规则格式"""
    try:
        data = yaml.safe_load(yaml_content)
    except yaml.YAMLError as e:
        print(f"YAML 解析错误: {e}")
        return []

    if not data or 'payload' not in data:
        print("YAML 文件中没有 payload 字段")
        return []

    rules = []
    for item in data['payload']:
        if not item or not isinstance(item, str):
            continue

        item = item.strip()
        if not item:
            continue

        # 去掉引号
        if (item.startswith("'") and item.endswith("'")) or \
           (item.startswith('"') and item.endswith('"')):
            item = item[1:-1]

        # 跳过注释
        if item.startswith('#'):
            continue

        # 解析规则类型
        if item.startswith('+.'):
            # +.domain.com -> DOMAIN-SUFFIX,domain.com
            domain = item[2:]
            rules.append(f"DOMAIN-SUFFIX,{domain}")
        elif item.startswith('.'):
            # .domain.com -> DOMAIN-SUFFIX,domain.com
            domain = item[1:]
            rules.append(f"DOMAIN-SUFFIX,{domain}")
        else:
            # domain.com -> DOMAIN,domain.com
            rules.append(f"DOMAIN,{item}")

    return rules


def process_yaml_backup(ini_path, output_dir):
    """处理 yaml_backup.ini 中的所有 YAML 文件"""
    rules_map = parse_yaml_backup_ini(ini_path)

    if not rules_map:
        print("yaml_backup.ini 中没有找到任何规则")
        return

    list_dir = f"{output_dir}/rules"
    srs_dir = f"{output_dir}/sing/rules"
    ensure_directory(list_dir)
    ensure_directory(srs_dir)

    for name, url in rules_map.items():
        print(f"处理: {name} <- {url}")

        response = fetch_url_content(url)
        if not response:
            print(f"  下载失败: {url}")
            continue

        # 转换 YAML 到 list 格式
        list_rules = convert_yaml_payload_to_list(response.text)
        if not list_rules:
            print(f"  转换失败或无有效规则: {name}")
            continue

        # 保存 .list 文件
        list_filename = f"{PREFIX}{name}.list"
        list_path = f"{list_dir}/{list_filename}"

        list_content = [rule + '\n' for rule in list_rules]
        if write_lines_to_file(list_content, list_path):
            print(f"  保存 list: {list_path} ({len(list_rules)} 条规则)")

        # 转换为 JSON 再编译为 SRS
        json_data = convert_list_to_json(list_path)
        json_path = f"{srs_dir}/{PREFIX}{name}.json"
        srs_path = f"{srs_dir}/{PREFIX}{name}.srs"

        if save_json_to_file(json_data, json_path):
            process_json_to_srs(srs_path, json_path)
            print(f"  保存 srs: {srs_path}")


if __name__ == "__main__":
    # 下载 sing-box 编译工具
    download_convert_bin()

    # 处理 yaml_backup.ini
    process_yaml_backup("yaml_backup.ini", "metadata")
