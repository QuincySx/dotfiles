import os
import requests
import json
import tarfile
import subprocess
from typing import List, Dict, Optional, Any


def download_file(url: str, filename: str, chunk_size: int = 8192) -> bool:
    """Download a file from URL with progress handling."""
    try:
        response = requests.get(url, stream=True)
        response.raise_for_status()
        
        with open(filename, 'wb') as file:
            for chunk in response.iter_content(chunk_size=chunk_size):
                file.write(chunk)
        return True
    except requests.RequestException as e:
        print(f"Error downloading {url}: {e}")
        return False


def fetch_url_content(url: str) -> Optional[requests.Response]:
    """Fetch content from URL and return response object."""
    try:
        response = requests.get(url)
        response.raise_for_status()
        return response
    except requests.RequestException as e:
        print(f"Error fetching {url}: {e}")
        return None


def ensure_directory(path: str) -> None:
    """Create directory if it doesn't exist."""
    os.makedirs(path, exist_ok=True)


def save_content_to_file(content: bytes, filepath: str) -> bool:
    """Save binary content to file."""
    try:
        with open(filepath, "wb") as file:
            file.write(content)
        return True
    except IOError as e:
        print(f"Error saving file {filepath}: {e}")
        return False


def save_json_to_file(data: Dict[str, Any], filepath: str) -> bool:
    """Save JSON data to file."""
    try:
        with open(filepath, 'w', encoding='utf-8') as file:
            json.dump(data, file, indent=2, ensure_ascii=False)
        return True
    except IOError as e:
        print(f"Error saving JSON file {filepath}: {e}")
        return False


def load_json_from_file(filepath: str) -> Optional[Dict[str, Any]]:
    """Load JSON data from file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as file:
            return json.load(file)
    except (IOError, json.JSONDecodeError) as e:
        print(f"Error loading JSON file {filepath}: {e}")
        return None


def read_lines_from_file(filepath: str) -> List[str]:
    """Read all lines from a text file."""
    try:
        with open(filepath, "r", encoding='utf-8') as file:
            return file.readlines()
    except IOError as e:
        print(f"Error reading file {filepath}: {e}")
        return []


def write_lines_to_file(lines: List[str], filepath: str) -> bool:
    """Write lines to a text file."""
    try:
        with open(filepath, "w", encoding='utf-8') as file:
            file.writelines(lines)
        return True
    except IOError as e:
        print(f"Error writing file {filepath}: {e}")
        return False


def extract_tar_gz(tar_filename: str, extract_path: str = ".") -> bool:
    """Extract tar.gz file."""
    try:
        with tarfile.open(tar_filename, "r:gz") as tar:
            tar.extractall(extract_path)
        return True
    except (tarfile.TarError, IOError) as e:
        print(f"Error extracting {tar_filename}: {e}")
        return False


def run_command(command: List[str]) -> bool:
    """Run a shell command and return success status."""
    try:
        subprocess.run(command, check=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Command failed: {' '.join(command)}, Error: {e}")
        return False


def get_filename_from_url(url: str) -> str:
    """Extract filename from URL."""
    return url.split("/")[-1]


def get_base_name_and_extension(filename: str) -> tuple[str, str]:
    """Get base name and extension from filename."""
    return os.path.splitext(filename)


def filter_lines(lines: List[str], predicate) -> List[str]:
    """Filter lines based on predicate function."""
    return [line for line in lines if predicate(line)]


def process_url_list(urls: List[str], processor_func, *args, **kwargs) -> List[Any]:
    """Process a list of URLs with given processor function."""
    results = []
    for url in urls:
        result = processor_func(url, *args, **kwargs)
        if result is not None:
            results.append(result)
    return results