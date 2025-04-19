import re
import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from utils import (
    read_lines_from_file, ensure_directory, fetch_url_content,
    get_filename_from_url, write_lines_to_file
)

def main():
    content = read_lines_from_file("Online_Full.ini")
    if not content:
        return

    ruleset_pattern = re.compile(r"ruleset=.*?,(https://.*?\.list)")
    ensure_directory("metadata")

    new_content = []

    for line in content:
        if not line.startswith(";"):
            urls = ruleset_pattern.findall(line)
            for url in urls:
                response = fetch_url_content(url)
                if response:
                    filename = get_filename_from_url(url)
                    new_url = f"https://raw.githubusercontent.com/QuincySx/CustomRules/metadata/rules/{filename}"
                    line = line.replace(url, new_url)
        new_content.append(line)

    write_lines_to_file(new_content, "metadata/Online_Full_Back.ini")


if __name__ == "__main__":
    main()
