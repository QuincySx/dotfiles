import os
import re
import requests

def main():
    with open("Online_Full.ini", "r") as file:
        content = file.readlines()

    ruleset_pattern = re.compile(r"ruleset=.*?,(https://.*?\.list)")

    os.makedirs("metadata", exist_ok=True)

    new_content = []

    for line in content:
        if not line.startswith(";"):
            urls = ruleset_pattern.findall(line)
            for url in urls:
                response = requests.get(url)
                if response.status_code == 200:
                    filename = url.split("/")[-1]
                    new_url = f"https://raw.githubusercontent.com/QuincySx/CustomRules/metadata/rules/{filename}"
                    line = line.replace(url, new_url)
                else:
                    print(f"Error downloading {url}: {response.status_code}")
        new_content.append(line)

    with open(os.path.join("metadata", "Online_Full_Back.ini"), "w") as file:
        file.writelines(new_content)


if __name__ == "__main__":
    main()
