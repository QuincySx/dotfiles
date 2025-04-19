import re
import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from utils import (
    read_lines_from_file, ensure_directory, fetch_url_content,
    save_content_to_file, get_filename_from_url
)

def main():
    content = read_lines_from_file("Online_Full.ini")
    if not content:
        return

    rules_pattern = re.compile(r"ruleset=.*?,(https://.*?\.list)")
    ensure_directory("metadata/rules")

    for line in content:
        if not line.startswith(";"):
            urls = rules_pattern.findall(line)
            for url in urls:
                response = fetch_url_content(url)
                if response:
                    filename = get_filename_from_url(url)
                    filepath = f"metadata/rules/{filename}"
                    save_content_to_file(response.content, filepath)


if __name__ == "__main__":
    main()
