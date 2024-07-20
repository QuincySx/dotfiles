import os
import re
import requests
import json
import tarfile
import subprocess

def backup_rule_set_and_download(input_file, output_dir='.'):
    # Read the input JSON file
    with open(input_file, 'r') as f:
        data = json.load(f)

    # Extract the rule_set from the route
    rule_set = data.get('route', {}).get('rule_set', [])

    # Create a directory for rule content
    rules_dir = os.path.join(output_dir, f"rules")
    os.makedirs(rules_dir, exist_ok=True)

    # Download and save rule content
    for rule in rule_set:
        url = rule.get('url')
        if url:
            try:
                response = requests.get(url)
                if response.status_code == 200:
                    filename = url.split("/")[-1]
                    filepath = os.path.join(rules_dir, filename)
                    with open(filepath, "wb") as file:
                        file.write(response.content)
                else:
                    print(f"Error downloading {url}: {response.status_code}")
            except requests.RequestException as e:
                print(f"Error downloading {url}: {str(e)}")


def convert_list_to_json(file_path):
    with open(file_path, 'r') as file:
        lines = file.readlines()

    rules = []
    current_rule = {}
    for line in lines:
        line = line.strip()
        if line and not line.startswith('#'):
            parts = line.split(',')
            if len(parts) == 2:
                rule_type, value = parts
                if rule_type == "DOMAIN-KEYWORD":
                    current_rule.setdefault("domain_keyword", []).append(value)
                elif rule_type == "DOMAIN-SUFFIX":
                    current_rule.setdefault("domain_suffix", []).append(value)
                elif rule_type == "DOMAIN":
                    current_rule.setdefault("domain", []).append(value)
                elif rule_type == "IP-CIDR":
                    current_rule.setdefault("ip_cidr", []).append(value)
                # 可以根据需要添加更多的规则类型
    if current_rule:
        rules.append(current_rule)

    return {"rules": rules, "version": 1}


def download_file(url, filename):
    response = requests.get(url, stream=True)
    with open(filename, 'wb') as file:
        for chunk in response.iter_content(chunk_size=8192):
            file.write(chunk)


def process_ac_files(directory, output_dir='.'):
    # Download sing-box
    sing_box_url = "https://github.com/SagerNet/sing-box/releases/download/v1.9.3/sing-box-1.9.3-linux-amd64.tar.gz"
    tar_filename = "sing-box-1.9.3-linux-amd64.tar.gz"
    download_file(sing_box_url, tar_filename)
       # Extract sing-box
    with tarfile.open(tar_filename, "r:gz") as tar:
        tar.extractall()
    os.chmod("./sing-box-1.9.3-linux-amd64/sing-box", 0o755)

    for filename in os.listdir(directory):
        if filename.startswith('Ac-') and filename.endswith('.list'):
            file_path = os.path.join(directory, filename)
            json_data = convert_list_to_json(file_path)

            json_filename = f"{os.path.splitext(filename)[0]}.json"
            json_path = os.path.join(output_dir, json_filename)

            with open(json_path, 'w') as f:
                json.dump(json_data, f, indent=2)

            # Compile JSON to SRS using sing-box
            srs_filename = f"{os.path.splitext(filename)[0]}.srs"
            srs_path = os.path.join(output_dir, srs_filename)

            try:
                subprocess.run([
                    "./sing-box-1.9.3-linux-amd64/sing-box",
                    "rule-set",
                    "compile",
                    "--output",
                    srs_path,
                    json_path
                ], check=True)
                print(f"Compiled {json_filename} to SRS: {srs_filename}")
            except subprocess.CalledProcessError as e:
                print(f"Error compiling {json_filename}: {e}")


if __name__ == "__main__":
    backup_rule_set_and_download("sing_config_template.json", "metadata/sing")
    process_ac_files("metadata/rules", "metadata/sing/rules")
