import os
import sys

def print_tree(dir_path, prefix=""):
    try:
        entries = sorted(os.listdir(dir_path))
    except PermissionError:
        print(f"{prefix}PermissionError: {dir_path}")
        return
    except FileNotFoundError:
        print(f"{prefix}NotFoundError: {dir_path}")
        return

    for i, entry in enumerate(entries):
        path = os.path.join(dir_path, entry)
        connector = "└── " if i == len(entries) - 1 else "├── "
        print(f"{prefix}{connector}{entry}")
        if os.path.isdir(path):
            new_prefix = prefix + ("    " if i == len(entries) - 1 else "│   ")
            print_tree(path, new_prefix)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python tree.py <directory>")
        sys.exit(1)
    root_dir = sys.argv[1]
    print(root_dir)
    print_tree(root_dir)