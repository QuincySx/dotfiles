import re
import json
import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from utils import (
    _d, read_lines_from_file, ensure_directory, fetch_url_content,
    save_content_to_file, get_filename_from_url, download_file,
    extract_tar_gz, run_command, load_json_from_file, save_json_to_file,
    get_base_name_and_extension
)

_SB = _d("c2luZy1ib3g=")
_SN = _d("U2FnZXJOZXQ=")

_bin_ver = "1.12.17"
_bin_name = f"{_SB}-{_bin_ver}-linux-amd64"
# _bin_name = f"{_SB}-{_bin_ver}-darwin-arm64"

IGNORE_PREFIXES = ("Ac-", "Bak-")


def download_convert_bin():
    if os.path.exists(f"./{_bin_name}/{_SB}"):
        return
    tar_filename = f"{_bin_name}.tar.gz"
    _bin_url = f"https://github.com/{_SN}/{_SB}/releases/download/v{_bin_ver}/{tar_filename}"

    if download_file(_bin_url, tar_filename):
        extract_tar_gz(tar_filename)
        os.chmod(f"./{_bin_name}/{_SB}", 0o755)


def process_json_to_srs(srs_path, json_path):
    command = [
        f"./{_bin_name}/{_SB}",
        "rule-set",
        "compile",
        "--output",
        srs_path,
        json_path
    ]
    if run_command(command):
        print(f"Compiled {json_path} to SRS: {srs_path}")


def download_and_convert_rule(url, rules_dir):
    response = fetch_url_content(url)
    if not response:
        return None

    filename = get_filename_from_url(url)
    base_name, ext = get_base_name_and_extension(filename)

    category = url.split('/')[-2]
    if 'geosite' in category or 'domainset' in category or 'geoip' in category:
        save_dir = f"{rules_dir}/{category}"
        ensure_directory(save_dir)
        filepath = f"{save_dir}/{filename}"
    else:
        filepath = f"{rules_dir}/{filename}"

    if ext.lower() == '.srs':
        json_url = url.rsplit('.', 1)[0] + '.json'
        json_response = fetch_url_content(json_url)

        if json_response:
            try:
                rule_data = json_response.json()
                rule_data['version'] = 2

                json_filepath = filepath.rsplit('.', 1)[0] + '.json'
                srs_filepath = filepath.rsplit('.', 1)[0] + '.srs'

                if save_json_to_file(rule_data, json_filepath):
                    process_json_to_srs(srs_filepath, json_filepath)
                    return srs_filepath
            except json.JSONDecodeError:
                print(f"JSON parse error: {json_url}")

        if save_content_to_file(response.content, filepath):
            return filepath
    else:
        if save_content_to_file(response.content, filepath):
            return filepath

    return None


def backup_rule_set_and_download(input_file, output_dir='.'):
    data = load_json_from_file(input_file)
    if not data:
        return

    rule_set = data.get('route', {}).get('rule_set', [])
    rules_dir = f"{output_dir}/rules"
    ensure_directory(rules_dir)

    new_rule_set = []
    for rule in rule_set:
        url = rule.get('url')
        if url:
            new_filepath = url
            rule['url'] = new_filepath

            filename = get_filename_from_url(url)
            if not filename.startswith(IGNORE_PREFIXES) and filename.endswith('.srs'):
                new_filepath = download_and_convert_rule(url, rules_dir)
                if new_filepath:
                    rel_path = new_filepath.removeprefix("repo/")
                    rule['url'] = f"https://testingcf.jsdelivr.net/gh/QuincySx/dotfiles@metadata/{rel_path}"

            if new_filepath:
                rule['format'] = 'binary' if new_filepath.endswith('.srs') else 'source'
                new_rule_set.append(rule)

    data['route']['rule_set'] = new_rule_set
    save_json_to_file(data, f"{output_dir}/sing_config_template_backup.json")


def convert_list_to_json(file_path):
    lines = read_lines_from_file(file_path)
    if not lines:
        return {"rules": [], "version": 2}

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
                elif rule_type == "DOMAIN-REGEX":
                    current_rule.setdefault("domain_regex", []).append(value)
            if len(parts) == 3:
                rule_type, value, flag = parts
                if rule_type == "IP-CIDR":
                    current_rule.setdefault("ip_cidr", []).append(value)
    if current_rule:
        rules.append(current_rule)

    return {"rules": rules, "version": 2}


def process_ac_files(directory, output_dir='.'):
    import os
    for filename in os.listdir(directory):
        if filename.startswith('Ac-') and filename.endswith('.list'):
            file_path = f"{directory}/{filename}"
            json_data = convert_list_to_json(file_path)

            base_name = get_base_name_and_extension(filename)[0]
            json_path = f"{output_dir}/{base_name}.json"
            srs_path = f"{output_dir}/{base_name}.srs"

            if save_json_to_file(json_data, json_path):
                process_json_to_srs(srs_path, json_path)


if __name__ == "__main__":
    download_convert_bin()
    process_ac_files("repo/rules", "repo/sing/rules")
    backup_rule_set_and_download("repo/source/sing_config_template.json", "repo/sing")
