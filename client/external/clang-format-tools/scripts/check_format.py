# Copyright (c) 2024, NVIDIA CORPORATION.  All rights reserved.
#
# Redistribution and use in source and binary forms, with or without modification, are permitted
# provided that the following conditions are met:
#     * Redistributions of source code must retain the above copyright notice, this list of
#       conditions and the following disclaimer.
#     * Redistributions in binary form must reproduce the above copyright notice, this list of
#       conditions and the following disclaimer in the documentation and/or other materials
#       provided with the distribution.
#     * Neither the name of the NVIDIA CORPORATION nor the names of its contributors may be used
#       to endorse or promote products derived from this software without specific prior written
#       permission.
#
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
# IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
# FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL NVIDIA CORPORATION BE LIABLE
# FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
# BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
# OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
# STRICT LIABILITY, OR TOR (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
# OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


import pathlib
import subprocess
import os
import sys
import fire
import shutil
import logging


"""Refer to README.md for the overall top level docs of this file"""


def get_parent_directory(file_path):
    """Given a file path, return the parent directory"""
    try:
        # Create a Path object from the file path
        path_obj = pathlib.Path(file_path)
        # Get the parent directory first parent is the actual dir of the script.
        # We need one higher to the root.
        parent_dir = path_obj.parent.parent
        return parent_dir
    except Exception as e:
        return str(e)


def get_config_path():
    """Return config/ path which is under the root of the repo"""
    # Get the absolute path of the currently executing script
    script_path = os.path.abspath(__file__)
    parent = get_parent_directory(script_path)
    return f"{parent}/config"

def read_text_file(file_path):
    """Read file into a tuple and return it. Used for file extensions"""
    try:
        with open(file_path, "r") as file:
            # Read all lines and remove trailing newline characters
            lines = [line.strip() for line in file.readlines()]
            return tuple(lines)
    except FileNotFoundError:
        return None


def is_clang_format_installed():
    """Return True if clang-format exists, False otherwise"""

    path = shutil.which("clang-format")
    if path is None:
        logging.error(
            "Cannot find clang-format installed/available in the environment. "
            "Please install or make sure it is in PATH"
        )
        return False
    logging.info(f"Found clang-format in path {path}")
    return True


def is_git_installed():
    """Return True if git installed, False otherwise"""

    path = shutil.which("git")
    if path is None:
        logging.error(
            "Cannot find git installed/available in the environment. "
            "Please install or make sure it is in PATH"
        )
        return False
    return True


def is_git_repo(project_root):
    """Return True if the provided project_root has .git, False otherwise"""
    return os.path.isdir(os.path.join(project_root, ".git"))


def get_changed_files(project_root, branch):
    """Retrieve files that changed vs the provided branch/tag/reference

    Run diff just to get the names of changed files between HEAD
    and the branch/tag/reference. Return a list of filenames/strings.
    """

    cmd = ["git", "-C", project_root, "diff", "--name-only", branch]
    result = subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    if result.returncode != 0:
        raise Exception(f"Error getting changed files: {result.stderr}")
    return result.stdout.strip().split("\n")


def is_c_family_file(filename):
    """Return True if this filename is a C/C++ source or header per this pattern"""
    config_path = get_config_path()
    extensions = read_text_file(f"{config_path}/file-extensions.txt")
    return filename.endswith(extensions)


def format_file(filename):
    """Run clang-format on the file and return the output of the formatted text"""

    cmd = ["clang-format", "--style=file", filename]
    result = subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    if result.returncode != 0:
        raise Exception(f"Error formatting file {filename}: {result.stderr}")
    return result.stdout


def diff_files(original, formatted):
    """Diff the original file and the result of clang-format

    The original file is the one from the repo as is.
    Formatted is the formatted file.
    """
    cmd = ["diff", "--color=auto", original, "-"]
    result = subprocess.run(
        cmd, input=formatted, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    return result.returncode, result.stdout


def check_format(project_root, branch):
    """Main function to check whether all files in the Change Request conform
    to the formatting rules.

    1. Setup logging
    2. check if clang-format, git exists
    3. Check if the provided project root has .git
    4. Obtain all filenames of the files in this Change Request. It is diffing
       against the provided branch/tag/reference.
    5. On each changed file, run clang-format and diff the result against the original
       file. Use the extensions read from the config file to only run format on these files.
       If there is a diff, it means the original file was submitted without formatting.
       Print a diagnostic and the diff found.
    6. Return 0 if all files in the Change Request are formatted correctly. -1 otherwise.
    """

    logging.basicConfig(level=logging.INFO)
    if not is_clang_format_installed():
        return -1
    if not is_git_installed():
        return -1

    path = pathlib.Path(project_root).resolve()
    if not is_git_repo(project_root):
        logging.error(f"{path} is not a git repository.")
        return -1
    else:
        logging.debug(f"Git repo is {path}")

    changed_files = get_changed_files(project_root, branch)
    logging.debug(f"Found changed files {changed_files}")
    all_diffs_zero = True

    for filename in changed_files:
        # isfile() so we avoid checking formatting on a file that was deleted
        if os.path.isfile(filename) and is_c_family_file(filename):
            formatted_content = format_file(filename)
            diff_returncode, diff_output = diff_files(filename, formatted_content)
            if diff_returncode != 0:
                all_diffs_zero = False
                print(f"Formatting issue detected in {filename}:", file=sys.stderr)
                print(diff_output, file=sys.stderr)

    return 0 if all_diffs_zero else -1


if __name__ == "__main__":
    fire.Fire(check_format)
