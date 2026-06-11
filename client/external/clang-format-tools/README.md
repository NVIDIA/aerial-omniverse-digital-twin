Configuration files
======================
Configuration file under `config/` directory exist to avoid information duplication throughout the codebase.
- `file-extensions.txt` - listing file extensions to use for `clang-format` run.

Thןד config file are being used in the `py` script, `cmake` files and the shell script.

When we need to know which directories to traverse for formatting - use `directories.txt`.
- `format-directories.txt` - listing directories - Each project has its own set of directories to traverse and format files.

When `clang-format` need to run on a set of files with specific extensions - use `file-extensions.txt`.

Check formatting tool for CI/CD
===================================

check `clang-format` tool when submitting Merge request.

Script is returning 0 when no clang-format violations. I.e. all files in the change request are formatted per requirements.

Script returns -1 otherwise, and will print to stderr the diff between the desired formatting and the original file.

Prerequisite of this script is to have:
- clang-format installed
- git installed
- Path to the repo is a git repo. I.e. it has .git directory.

It is using `fire` as its command line module:

```
NAME
    check_format.py

SYNOPSIS
    check_format.py PROJECT_ROOT BRANCH

POSITIONAL ARGUMENTS
    PROJECT_ROOT
    BRANCH

NOTES
    You can also use flags syntax for POSITIONAL ARGUMENTS
```

Run clang-format bash script on asim_em tree
============================================
Provided bash script `run-clang-format.sh` will format the file extensions mentioned in `config/file-extensions.txt` using `clang-format`.

The directories mentioned in the files passed as an argument will be formatted.

`clang-format` is based on `LLVM` without sorting includes preprocessor directives.

Running the bash script in the root directory `asim_em`:
```shell
./external/clang-format-tools.sh
```

Run CMake target using the provided cmake/clang-format-util.cmake file
=======================================================================
`asim_em` will be adding `external/clang-format-tools/cmake/clang-format-util.cmake` in the root `CMakeLists.txt`.

Example from the current `asim_em` code:

```
include(external/clang-format-tools/cmake/clang-format-util.cmake)
...
# retrieve the dirs here.
add_clang_format_target(TARGET_PREFIX aodt
                        DIRS ${all_dirs})
```

This allows you to run cmake target like the following:
```
cmake --build <build dir> --target aodt_format_all_source_files
```

In order to format all source files in the directories.
