# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Load calibrated beamforming codebooks from S3."""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections.abc import Mapping, Sequence
from types import SimpleNamespace
from typing import Union

CODEBOOK_PREFIX_SUFFIX = "Calibrated/Codebooks/"
CODEBOOK_FILENAME_SUFFIX = "_codebook.csv"
EMPTY_PAYLOAD_HASH = hashlib.sha256(b"").hexdigest()

YamlScalar = Union[str, int, float, bool, None]
YamlValue = Union[YamlScalar, Sequence["YamlValue"], Mapping[str, "YamlValue"]]
YamlMapping = Mapping[str, YamlValue]


def build_codebook_s3_prefix(raw_yaml: YamlMapping) -> str:
    """Build the calibrated codebook S3 prefix."""
    cal_section = _mapping_field(raw_yaml, "cal", "YAML root")
    output_section = _mapping_field(cal_section, "output", "cal")
    folder_key = output_section.get("folder_key")
    if not isinstance(folder_key, str) or not folder_key.strip():
        raise ValueError("Missing required cal.output.folder_key")

    return f"{folder_key.strip('/')}/{CODEBOOK_PREFIX_SUFFIX}"


def select_optional_codebook_key(
    keys: Sequence[str],
    prefix: str,
) -> str | None:
    """Select one codebook CSV under the calibrated prefix."""
    matches = [
        key
        for key in keys
        if key.startswith(prefix) and key.endswith(CODEBOOK_FILENAME_SUFFIX)
    ]
    if not matches:
        return None
    if len(matches) > 1:
        raise ValueError(
            f"Expected at most one *{CODEBOOK_FILENAME_SUFFIX} under "
            f"s3 prefix {prefix!r}, found {len(matches)}: {matches}"
        )
    return matches[0]

def list_s3_keys(s3_config: SimpleNamespace, prefix: str) -> list[str]:
    """List S3 object keys below a prefix."""
    response_text = _request_s3_text(
        s3_config=s3_config,
        object_key="",
        query_params={
            "list-type": "2",
            "prefix": prefix,
        },
    )
    root = ET.fromstring(response_text)
    return [
        key_node.text
        for key_node in root.findall(".//{*}Key")
        if key_node.text is not None
    ]


def get_s3_text_object(s3_config: SimpleNamespace, object_key: str) -> str:
    """Fetch one S3 object as UTF-8 text."""
    return _request_s3_text(
        s3_config=s3_config,
        object_key=object_key,
        query_params={},
    )


def _request_s3_text(
    s3_config: SimpleNamespace,
    object_key: str,
    query_params: Mapping[str, str],
) -> str:
    """Return text from a signed S3 GET request."""
    request_url, headers = _build_signed_s3_get(
        s3_config=s3_config,
        object_key=object_key,
        query_params=query_params,
    )
    request = urllib.request.Request(
        request_url,
        headers=headers,
        method="GET",
    )
    with urllib.request.urlopen(request) as response:
        return response.read().decode("utf-8")


def _build_signed_s3_get(
    s3_config: SimpleNamespace,
    object_key: str,
    query_params: Mapping[str, str],
) -> tuple[str, dict[str, str]]:
    """Build a path-style S3 GET URL and headers."""
    endpoint_url = _required_attr(s3_config, "endpoint_url").rstrip("/")
    bucket = _required_attr(s3_config, "bucket")
    access_key = _optional_attr(s3_config, "access_key")
    secret_key = _optional_attr(s3_config, "secret_key")
    region = _optional_attr(s3_config, "region") or "us-east-1"

    parsed_endpoint = urllib.parse.urlparse(endpoint_url)
    host = parsed_endpoint.netloc
    canonical_uri = _canonical_uri(bucket, object_key)
    query_string = _canonical_query_string(query_params)
    request_url = f"{endpoint_url}{canonical_uri}"
    if query_string:
        request_url = f"{request_url}?{query_string}"

    if not access_key or not secret_key:
        return request_url, {}

    now = dt.datetime.utcnow()
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    headers = {
        "host": host,
        "x-amz-content-sha256": EMPTY_PAYLOAD_HASH,
        "x-amz-date": amz_date,
    }
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_headers = "".join(f"{key}:{headers[key]}\n" for key in headers)
    canonical_request = "\n".join(
        [
            "GET",
            canonical_uri,
            query_string,
            canonical_headers,
            signed_headers,
            EMPTY_PAYLOAD_HASH,
        ]
    )
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signing_key = _aws_v4_signing_key(secret_key, date_stamp, region)
    signature = hmac.new(
        signing_key,
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    authorization = (
        "AWS4-HMAC-SHA256 "
        f"Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    headers["Authorization"] = authorization
    return request_url, headers


def _canonical_uri(bucket: str, object_key: str) -> str:
    """Build the path-style canonical URI."""
    parts = [bucket]
    if object_key:
        parts.extend(object_key.split("/"))
    return "/" + "/".join(
        urllib.parse.quote(part, safe="-_.~") for part in parts
    )


def _canonical_query_string(query_params: Mapping[str, str]) -> str:
    """Return SigV4 canonical query string."""
    return "&".join(
        f"{urllib.parse.quote(key, safe='-_.~')}="
        f"{urllib.parse.quote(value, safe='-_.~')}"
        for key, value in sorted(query_params.items())
    )


def _aws_v4_signing_key(
    secret_key: str,
    date_stamp: str,
    region: str,
) -> bytes:
    """Derive an AWS SigV4 signing key."""
    date_key = _sign(f"AWS4{secret_key}".encode("utf-8"), date_stamp)
    region_key = _sign(date_key, region)
    service_key = _sign(region_key, "s3")
    return _sign(service_key, "aws4_request")


def _sign(key: bytes, message: str) -> bytes:
    """Return an HMAC-SHA256 digest."""
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).digest()


def _mapping_field(
    mapping: YamlMapping,
    field_name: str,
    parent_name: str,
) -> YamlMapping:
    """Read a nested mapping field."""
    value = mapping.get(field_name)
    if not isinstance(value, Mapping):
        raise ValueError(f"Missing required {parent_name}.{field_name}")
    return value


def _required_attr(config: SimpleNamespace, attr_name: str) -> str:
    """Read a required S3 config string."""
    value = getattr(config, attr_name, None)
    if not isinstance(value, str) or not value:
        raise ValueError(f"S3 config missing required {attr_name!r}")
    return value


def _optional_attr(config: SimpleNamespace, attr_name: str) -> str:
    """Read an optional S3 config string."""
    value = getattr(config, attr_name, "")
    return value if isinstance(value, str) else ""
