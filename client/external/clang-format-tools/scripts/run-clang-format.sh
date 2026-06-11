#!/usr/bin/env bash

# ***************************************************************************
# Copyright (c) 2024, NVIDIA CORPORATION. All rights reserved.
#
# NVIDIA CORPORATION and its licensors retain all intellectual property
# and proprietary rights in and to this software, related documentation
# and any modifications thereto. Any use, reproduction, disclosure or
# distribution of this software and related documentation without an express
# license agreement from NVIDIA CORPORATION is strictly prohibited.
# **************************************************************************

# Enable for debugging
set -ex

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            echo "Usage: ./run-clang-format.sh [OPTIONS]"
            echo "Options:"
            echo "  -h, --help                     Show this help message"
            echo "  -d, --format-directories-file  Specify the file containing a list of directories to format"
            exit 0
            ;;
        -d|--format-directories-file)
            FORMAT_DIRECTORIES_FILE="$2"
            shift # past argument
            shift # past value
            ;;
    esac
done

if [[ -z ${FORMAT_DIRECTORIES_FILE} ]]; then
  echo "Need to provide -d/--format-directories-file - Specify the file containing a list of directories to format"
  exit 1
fi

echo -n "Running with clang-format version:"
clang-format --version

# Get the absolute path of the script, we would need the config/ dir
# for each scripting
script_path=$(readlink -f "$0")
config_path="$(dirname "${script_path}")/../config"

echo "Running formatting on files ..."
dirs=$(tr '\n' ' ' <"${FORMAT_DIRECTORIES_FILE}")

# Assemble -name name0- -o -name name1 ...
# to match -name *.cpp etc...
first=true
all_dirs=
for e in $(<"${config_path}/file-extensions.txt")
do
if [[ $e == \#* ]] || [[ -z $e ]]; then
  continue
fi
if [[ ${first} == true ]]; then
  first=false
  all_dirs="${all_dirs} -name *.$e "
else
  all_dirs="${all_dirs} -o -name *.$e "
fi
done

find ${dirs} \( ${all_dirs} \) -print0 -exec clang-format -style=file -i {} \;
