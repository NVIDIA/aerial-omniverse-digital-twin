# ***************************************************************************
# Copyright (c) 2024, NVIDIA CORPORATION. All rights reserved.
#
# NVIDIA CORPORATION and its licensors retain all intellectual property
# and proprietary rights in and to this software, related documentation
# and any modifications thereto. Any use, reproduction, disclosure or
# distribution of this software and related documentation without an express
# license agreement from NVIDIA CORPORATION is strictly prohibited.
# **************************************************************************

# Function will create target that will run clang-format on source files
# ARGS: 1. prefix of the target 2. List of dirs to glob for source files.
# 
# aodt is the target prefix
# usage example: add_clang_format_target(TARGET_PREFIX aodt
#                                        DIRS          dir1 dir2 dir3)
# cmake --build <build dir> --target aodt_format_all_source_files
#
# 1. Make sure clang-format exe exists
# 2. For each dir, glob all files recursively
# 3. Create a list of all files across all dirs
# 4. Create custom target that will run clang-format on all files.
#    Use the provided, first argument as the target_prefix
# 5. Create dependencies between the files and the clang-format custom target.
function(add_clang_format_target)
    # Function keywords
    set(prefix ADD_CLANG_FORMAT)
    set(target_prefix TARGET_PREFIX)
    set(dirs DIRS)
    include(CMakeParseArguments)
    cmake_parse_arguments(
            "${prefix}"      # Prefix for the variables
            ""               # we have no bools/optional
            ${target_prefix} # single
            ${dirs}          # multi
            ${ARGN}
    )

    set(intermediate_target_prefix ${${prefix}_${target_prefix}}_format_dir)
    set(final_target ${${prefix}_${target_prefix}}_format_all_source_files)

    # Make sure clang-format exists
    find_program(cf_exe clang-format REQUIRED)

    # Read extensions from config file
    set(file_extensions "${PROJECT_SOURCE_DIR}/external/clang-format-tools/config/file-extensions.txt")
    execute_process(
            COMMAND cat ${file_extensions}
            OUTPUT_VARIABLE file_extensions_content
            OUTPUT_STRIP_TRAILING_WHITESPACE
    )
    # convert to a cmake list
    string(REPLACE "\n" ";" file_ext_as_list "${file_extensions_content}")

    # Create an empty list to store all the files
    set(all_format_targets)

    set(all_dirs ${${prefix}_${dirs}})
    # Iterate over each directory
    foreach(dir IN LISTS all_dirs)
        set(all_extensions)
        foreach (ext IN LISTS file_ext_as_list)
            # ext already containing dot. so *${ext} and not *.${ext}
            set(modified_ext "${PROJECT_SOURCE_DIR}/${dir}/*${ext}")
            list(APPEND all_extensions ${modified_ext})
        endforeach ()
        # Use GLOB_RECURSE to find all .cpp and .h files
        file(GLOB_RECURSE files_to_format ${all_extensions})
        # Append the files to the ALL_FILES list
        # Create a custom target
        # In case we have x/y/z, we need to sanitize it to x_y_z
        # since targets cannot be with `/`
        string(REPLACE "/" "_" dir_sanitized ${dir})
        add_custom_target(${intermediate_target_prefix}_${dir_sanitized}
                WORKING_DIRECTORY ${PROJECT_SOURCE_DIR}
                COMMAND clang-format -style=file -i ${files_to_format}
                COMMENT "Running clang-format on all files starting at ${dir}"
                VERBATIM
        )
        list(APPEND all_format_targets ${intermediate_target_prefix}_${dir_sanitized})
    endforeach()
    add_custom_target(${final_target} DEPENDS ${all_format_targets})
endfunction()
