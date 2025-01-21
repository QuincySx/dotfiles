import os
import re
import requests
import json
import tarfile
import subprocess

sing_box_version="1.10.0-beta.12"
sing_box_name = f"sing-box-{sing_box_version}-linux-amd64"
# sing_box_name = f"sing-box-{sing_box_version}-darwin-arm64"

def download_file(url, filename):
    response = requests.get(url, stream=True)
    with open(filename, 'wb') as file:
        for chunk in response.iter_content(chunk_size=8192):
            file.write(chunk)


def download_convert_bin():
    # Download sing-box
    tar_filename = f"{sing_box_name}.tar.gz"
    sing_box_url = f"https://github.com/SagerNet/sing-box/releases/download/v{sing_box_version}/{tar_filename}"

    download_file(sing_box_url, tar_filename)
    # Extract sing-box
    with tarfile.open(tar_filename, "r:gz") as tar:
        tar.extractall()
    os.chmod(f"./{sing_box_name}/sing-box", 0o755)


def process_json_to_srs(srs_path, json_path):
    try:
        subprocess.run([
            f"./{sing_box_name}/sing-box",
            "rule-set",
            "compile",
            "--output",
            srs_path,
            json_path
        ], check=True)
        print(f"Compiled {json_path} to SRS: {srs_path}")
    except subprocess.CalledProcessError as e:
        print(f"Error compiling {json_path}: {e}")


def download_and_convert_rule(url, rules_dir):
    try:
        response = requests.get(url)
        if response.status_code == 200:
            filename = url.split("/")[-1]
            base_name, ext = os.path.splitext(filename)

            # 确定保存路径
            category = url.split('/')[-2]
            if 'geosite' in category or 'domainset' in category or 'geoip' in category:
                save_dir = os.path.join(rules_dir, category)
                os.makedirs(save_dir, exist_ok=True)
                filepath = os.path.join(save_dir, filename)
            else:
                filepath = os.path.join(rules_dir, filename)

            if ext.lower() == '.srs':
                json_url = url.rsplit('.', 1)[0] + '.json'
                json_response = requests.get(json_url)

                if json_response.status_code == 200:
                    rule_data = json_response.json()
                    rule_data['version'] = 2

                    # 保存 JSON 文件
                    json_filepath = filepath.rsplit('.', 1)[0] + '.json'
                    srs_filepath = filepath.rsplit('.', 1)[0] + '.srs'
                    with open(json_filepath, 'w') as json_file:
                        json.dump(rule_data, json_file, indent=2, ensure_ascii=False)

                    # 将 JSON 转换为 SRS
                    process_json_to_srs(srs_filepath, json_filepath)
                    print(f"成功将 JSON 转换为 SRS: {srs_filepath}")
                    return srs_filepath;
                else:
                    print(f"下载 JSON 时出错 {json_url}: {json_response.status_code}")
                    # 如果 JSON 下载失败，则保存原始 SRS 文件
                    with open(filepath, "wb") as file:
                        file.write(response.content)
                    print(f"保存原始 SRS 文件: {filepath}")
                    return filepath;
            else:
                # 对于非 SRS 文件，直接保存
                with open(filepath, "wb") as file:
                    file.write(response.content)
                print(f"成功下载并保存文件: {filepath}")
                return filepath;
        else:
            print(f"下载 {url} 时出错: {response.status_code}")
    except requests.RequestException as e:
        print(f"下载 {url} 时出错: {str(e)}")


def backup_rule_set_and_download(input_file, output_dir='.'):
    # Read the input JSON file
    with open(input_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Extract the rule_set from the route
    rule_set = data.get('route', {}).get('rule_set', [])

    # Create a directory for rule content
    rules_dir = os.path.join(output_dir, f"rules")
    os.makedirs(rules_dir, exist_ok=True)

    # Download and save rule content
    new_rule_set = []
    for rule in rule_set:
        url = rule.get('url')
        if url:
            try:
                new_filepath = url
                rule['url'] = new_filepath

                # filter AC-*.srs
                if not url.split('/')[-1].startswith('Ac-') and url.split('/')[-1].endswith('.srs'):
                    new_filepath = download_and_convert_rule(url, rules_dir)
                    rule['url'] = f"https://testingcf.jsdelivr.net/gh/QuincySx/CustomRules@{new_filepath}"

                if new_filepath != None:
                    if(new_filepath.endswith('.srs')):
                        rule['format'] = 'binary'
                    else:
                        rule['format'] = 'source'
                    new_rule_set.append(rule)
            except requests.RequestException as e:
                print(f"Error downloading {url}: {str(e)}")

    data['route']['rule_set'] = new_rule_set

    with open(os.path.join(output_dir, 'sing_config_template_backup.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def convert_list_to_json(file_path):
    with open(file_path, 'r') as file:
        lines = file.readlines()

    rules = []
    current_rule = {}
    for line in lines:
        line = line.strip()
        if line and not line.startswith('#'):
            parts = line.split(',')
            if len(parts) == 2 or len(parts) == 3:
                rule_type, value = parts
                if rule_type == "DOMAIN-KEYWORD":
                    current_rule.setdefault("domain_keyword", []).append(value)
                elif rule_type == "DOMAIN-SUFFIX":
                    current_rule.setdefault("domain_suffix", []).append(value)
                elif rule_type == "DOMAIN":
                    current_rule.setdefault("domain", []).append(value)
                elif rule_type == "IP-CIDR":
                    current_rule.setdefault("ip_cidr", []).append(value)
                elif rule_type == "DOMAIN-REGEX":
                    current_rule.setdefault("domain_regex", []).append(value)
                # 可以根据需要添加更多的规则类型
    if current_rule:
        rules.append(current_rule)

    return {"rules": rules, "version": 2}


def process_ac_files(directory, output_dir='.'):
    for filename in os.listdir(directory):
        if filename.startswith('Ac-') and filename.endswith('.list'):
            file_path = os.path.join(directory, filename)
            json_data = convert_list_to_json(file_path)

            json_filename = f"{os.path.splitext(filename)[0]}.json"
            json_path = os.path.join(output_dir, json_filename)

            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(json_data, f, indent=2, ensure_ascii=False)

            # Compile JSON to SRS using sing-box
            srs_filename = f"{os.path.splitext(filename)[0]}.srs"
            srs_path = os.path.join(output_dir, srs_filename)

            process_json_to_srs(srs_path, json_path)


if __name__ == "__main__":
    download_convert_bin()
    process_ac_files("metadata/rules", "metadata/sing/rules")
    backup_rule_set_and_download("sing_config_template.json", "metadata/sing")
