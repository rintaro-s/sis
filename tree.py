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

# node_modulesとreleaseをスキップ
    entries = [e for e in entries if e not in ("node_modules", "release")]

    files = [e for e in entries if os.path.isfile(os.path.join(dir_path, e))]
    dirs = [e for e in entries if os.path.isdir(os.path.join(dir_path, e))]

    # ファイルが20個以上の場合
    max_files = 20
    show_files = files[:max_files]
    omit_files = len(files) - max_files

    total_entries = show_files + dirs
    for i, entry in enumerate(total_entries):
        path = os.path.join(dir_path, entry)
        connector = "└── " if i == len(total_entries) - 1 else "├── "
        print(f"{prefix}{connector}{entry}")
        if os.path.isdir(path):
            new_prefix = prefix + ("    " if i == len(total_entries) - 1 else "│   ")
            print_tree(path, new_prefix)

    if omit_files > 0:
        connector = "└── " if len(dirs) == 0 else "├── "
        print(f"{prefix}{connector}～省略～ ({omit_files} files)")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python tree.py <directory>")
        sys.exit(1)
    root_dir = sys.argv[1]
    print(root_dir)
    print_tree(root_dir)