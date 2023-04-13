import os
import re
import requests

def main():
    with open("Online_Full.ini", "r") as file:
        content = file.readlines()

    rules_pattern = re.compile(r"ruleset=.*?,(https://.*?\.list)")

    os.makedirs("metadata/rules", exist_ok=True)

    for line in content:
        if not line.startswith(";"):
            urls = rules_pattern.findall(line)
            for url in urls:
                response = requests.get(url)
                if response.status_code == 200:
                    filename = url.split("/")[-1]
                    filepath = os.path.join("metadata/rules", filename)
                    with open(filepath, "wb") as file:
                        file.write(response.content)
                else:
                    print(f"Error downloading {url}: {response.status_code}")


if __name__ == "__main__":
    main()
