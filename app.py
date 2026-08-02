import os
import re
import json
import csv
import time
import struct
import hashlib
import logging
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

import requests
from requests import Response, Session
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from dotenv import load_dotenv, find_dotenv

env_path = find_dotenv()
if env_path:
    load_dotenv(dotenv_path=env_path)

RESULTS_PER_PAGE = 10
DEFAULT_SEARCH_TIMEOUT = 30
DEFAULT_CONNECT_TIMEOUT = 10
DEFAULT_MAX_FETCH_BYTES = 20 * 1024 * 1024

IMAGE_EXTENSIONS = {
    "jpeg": ".jpg",
    "png": ".png",
    "gif": ".gif",
    "webp": ".webp",
    "bmp": ".bmp",
    "svg": ".svg",
    "ico": ".ico",
    "tiff": ".tif",
    "avif": ".avif",
    "heic": ".heic",
}

CONTENT_TYPE_FORMATS = {
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/pjpeg": "jpeg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/x-ms-bmp": "bmp",
    "image/svg+xml": "svg",
    "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico",
    "image/tiff": "tiff",
    "image/avif": "avif",
    "image/heic": "heic",
}


@dataclass
class ImageResult:
    query: str
    title: str
    link: str
    snippet: str
    mime: str = ""
    file_format: str = ""
    context_link: str = ""
    thumbnail_link: str = ""
    thumbnail_width: Optional[int] = None
    thumbnail_height: Optional[int] = None
    api_width: Optional[int] = None
    api_height: Optional[int] = None
    api_byte_size: Optional[int] = None
    page_number: int = 0
    search_rank: int = 0
    source_rank: int = 0
    status: str = ""
    saved_as: str = ""
    error: str = ""
    http_status: Optional[int] = None
    content_type: str = ""
    content_length: Optional[int] = None
    fetched_at: str = ""
    sha256: str = ""
    final_url: str = ""
    format: str = ""
    width: Optional[int] = None
    height: Optional[int] = None
    byte_size: Optional[int] = None


@dataclass
class SearchError:
    query: str
    page_number: int
    error_type: str
    message: str
    http_status: Optional[int] = None


def _parse_queries(raw: str) -> List[str]:
    if not raw:
        return []
    raw = raw.strip()
    if raw.startswith("["):
        try:
            arr = json.loads(raw)
            return [str(x).strip() for x in arr if str(x).strip()]
        except Exception:
            pass
    return [q.strip() for q in raw.split(",") if q.strip()]


def _parse_domain_list(raw: str) -> List[str]:
    if not raw:
        return []
    raw = raw.strip()
    if raw.startswith("["):
        try:
            arr = json.loads(raw)
            return [str(x).strip().lower() for x in arr if str(x).strip()]
        except Exception:
            pass
    return [d.strip().lower() for d in raw.split(",") if d.strip()]


def _int_env(name: str, default: int) -> int:
    v = os.getenv(name, "")
    try:
        return int(v) if v.strip() else default
    except Exception:
        return default


def _float_env(name: str, default: float) -> float:
    v = os.getenv(name, "")
    try:
        return float(v) if v.strip() else default
    except Exception:
        return default


def safe_filename(name: str) -> str:
    name = re.sub(r"[^\w\s\-.()]+", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name[:120] or "image"


def short_hash(text: str, length: int = 8) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:length]


def guess_filename_from_url(url: str) -> str:
    try:
        name = Path(urlparse(url).path).name
        return safe_filename(Path(name).stem) or "image"
    except Exception:
        return "image"


def normalize_url(url: str) -> str:
    try:
        parsed = urlparse(url.strip())
        tracking_params = {
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_term",
            "utm_content",
            "gclid",
            "fbclid",
        }
        kept_params = [
            (k, v)
            for k, v in parse_qsl(parsed.query, keep_blank_values=True)
            if k not in tracking_params
        ]
        kept_params.sort()
        normalized = parsed._replace(
            scheme=parsed.scheme.lower(),
            netloc=parsed.netloc.lower(),
            query=urlencode(kept_params),
            fragment="",
        )
        return urlunparse(normalized)
    except Exception:
        return url.strip()


def extract_hostname(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def is_blocked_domain(url: str, blocked_domains: List[str]) -> bool:
    hostname = extract_hostname(url)
    if not hostname:
        return False

    for blocked in blocked_domains:
        blocked = blocked.lower().strip()
        if not blocked:
            continue
        if hostname == blocked or hostname.endswith(f".{blocked}"):
            return True

    return False


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sniff_image_format(data: bytes) -> str:
    if len(data) < 12:
        return ""
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:2] == b"BM":
        return "bmp"
    if data[:4] == b"\x00\x00\x01\x00":
        return "ico"
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return "tiff"
    if data[4:12] == b"ftypavif":
        return "avif"
    if data[4:12] in (b"ftypheic", b"ftypheix", b"ftypmif1"):
        return "heic"
    head = data[:1024].lstrip()
    if head[:5] == b"<?xml" and b"<svg" in data[:2048]:
        return "svg"
    if head[:4] == b"<svg":
        return "svg"
    return ""


def _jpeg_dimensions(data: bytes) -> Optional[Tuple[int, int]]:
    pos = 2
    size = len(data)
    while pos + 9 < size:
        if data[pos] != 0xFF:
            pos += 1
            continue
        marker = data[pos + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            pos += 2
            continue
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            height, width = struct.unpack(">HH", data[pos + 5 : pos + 9])
            return width, height
        seg_len = struct.unpack(">H", data[pos + 2 : pos + 4])[0]
        pos += 2 + seg_len
    return None


def _webp_dimensions(data: bytes) -> Optional[Tuple[int, int]]:
    if len(data) < 30:
        return None
    chunk = data[12:16]
    if chunk == b"VP8X":
        width = int.from_bytes(data[24:27], "little") + 1
        height = int.from_bytes(data[27:30], "little") + 1
        return width, height
    if chunk == b"VP8 ":
        width = struct.unpack("<H", data[26:28])[0] & 0x3FFF
        height = struct.unpack("<H", data[28:30])[0] & 0x3FFF
        return width, height
    if chunk == b"VP8L":
        bits = int.from_bytes(data[21:25], "little")
        width = (bits & 0x3FFF) + 1
        height = ((bits >> 14) & 0x3FFF) + 1
        return width, height
    return None


def image_dimensions(data: bytes, fmt: str) -> Optional[Tuple[int, int]]:
    try:
        if fmt == "png" and len(data) >= 24:
            width, height = struct.unpack(">II", data[16:24])
            return width, height
        if fmt == "gif" and len(data) >= 10:
            width, height = struct.unpack("<HH", data[6:10])
            return width, height
        if fmt == "bmp" and len(data) >= 26:
            width, height = struct.unpack("<ii", data[18:26])
            return abs(width), abs(height)
        if fmt == "jpeg":
            return _jpeg_dimensions(data)
        if fmt == "webp":
            return _webp_dimensions(data)
    except Exception:
        return None
    return None


def build_session(user_agent: str) -> Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": user_agent,
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }
    )

    retry = Retry(
        total=2,
        connect=2,
        read=1,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
        raise_on_status=False,
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


def setup_logger(log_path: Path) -> logging.Logger:
    log_path.parent.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger("image_finder")
    logger.setLevel(logging.INFO)

    if not logger.handlers:
        file_fmt = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

        fh = logging.FileHandler(log_path, encoding="utf-8")
        fh.setFormatter(file_fmt)
        logger.addHandler(fh)

        ch = logging.StreamHandler()
        ch.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(ch)

    return logger


def classify_google_error(
    response: Optional[Response], data: Optional[Dict[str, Any]], exc: Optional[Exception]
) -> Tuple[str, str, Optional[int]]:
    if response is not None:
        status = response.status_code
        try:
            err_obj = (data or {}).get("error", {})
            message = err_obj.get("message") or response.text[:500]
        except Exception:
            message = response.text[:500]

        lowered = (message or "").lower()

        if status == 403 and ("quota" in lowered or "limit" in lowered):
            return "quota_exceeded", message, status
        if status == 403 and ("key" in lowered or "credential" in lowered or "access" in lowered):
            return "auth_error", message, status
        if status == 400:
            return "bad_request", message, status
        if status == 429:
            return "rate_limited", message, status
        if 500 <= status <= 599:
            return "server_error", message, status
        return "http_error", message, status

    if exc is not None:
        msg = str(exc)
        lowered = msg.lower()
        if "timeout" in lowered:
            return "timeout", msg, None
        if "connection" in lowered:
            return "connection_error", msg, None
        return "request_error", msg, None

    return "unknown_error", "Unknown error", None


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Search Google Custom Search image results and download each image file."
    )
    parser.add_argument(
        "--query",
        action="append",
        dest="queries",
        help="Query to search. Can be supplied multiple times.",
    )
    parser.add_argument(
        "--pages",
        type=int,
        default=None,
        help="Maximum number of Google CSE result pages to request per query.",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=None,
        help="Delay between requests in seconds.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=None,
        help="Request timeout in seconds for image downloads.",
    )
    parser.add_argument(
        "--search-timeout",
        type=int,
        default=None,
        help="Request timeout in seconds for Google CSE search calls.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=None,
        help="Number of concurrent download workers.",
    )
    parser.add_argument(
        "--max-bytes",
        type=int,
        default=None,
        help="Maximum bytes to download per image (0 disables the cap).",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Root output folder; manifests are written at its root and image files in <output>/images.",
    )
    parser.add_argument(
        "--log-file",
        default=None,
        help="Log file name or absolute path.",
    )
    parser.add_argument(
        "--api-endpoint",
        default=None,
        help="Google CSE JSON API endpoint.",
    )
    parser.add_argument(
        "--user-agent",
        default=None,
        help="User-Agent to use for requests.",
    )
    parser.add_argument(
        "--blocked-domain",
        action="append",
        dest="blocked_domains",
        help="Domain to avoid downloading from. Can be supplied multiple times.",
    )
    parser.add_argument(
        "--img-size",
        default=None,
        help="Google CSE imgSize filter (icon, small, medium, large, xlarge, xxlarge, huge).",
    )
    parser.add_argument(
        "--img-type",
        default=None,
        help="Google CSE imgType filter (clipart, face, lineart, stock, photo, animated).",
    )
    parser.add_argument(
        "--img-color-type",
        default=None,
        help="Google CSE imgColorType filter (color, gray, mono, trans).",
    )
    parser.add_argument(
        "--img-dominant-color",
        default=None,
        help="Google CSE imgDominantColor filter (black, blue, brown, gray, green, ...).",
    )
    parser.add_argument(
        "--file-type",
        default=None,
        help="Google CSE fileType filter (jpg, png, gif, svg, webp, ...).",
    )
    parser.add_argument(
        "--rights",
        default=None,
        help="Google CSE usage-rights filter (cc_publicdomain, cc_attribute, ...).",
    )
    parser.add_argument(
        "--safe",
        default=None,
        help="Google CSE SafeSearch level (off or active).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Search and write manifests without downloading images.",
    )
    return parser


def load_config(args: argparse.Namespace) -> Dict[str, Any]:
    api_key = os.getenv("API_KEY")
    cx = os.getenv("CX")

    if not api_key or not cx:
        raise SystemExit("Missing required values in .env or environment (API_KEY and CX are mandatory).")

    env_queries = _parse_queries(os.getenv("QUERIES", ""))
    cli_queries = args.queries or []
    queries = cli_queries if cli_queries else env_queries

    if not queries:
        raise SystemExit("No queries provided. Use --query or set QUERIES in .env.")

    env_blocked_domains = _parse_domain_list(os.getenv("BLOCKED_DOWNLOAD_DOMAINS", ""))
    cli_blocked_domains = [d.strip().lower() for d in (args.blocked_domains or []) if d.strip()]
    blocked_domains = cli_blocked_domains if cli_blocked_domains else env_blocked_domains

    pages = args.pages if args.pages is not None else _int_env("PAGES", 10)
    delay = args.delay if args.delay is not None else _float_env("DELAY", 0.0)
    timeout = args.timeout if args.timeout is not None else _int_env("TIMEOUT", 30)
    search_timeout = (
        args.search_timeout
        if args.search_timeout is not None
        else _int_env("SEARCH_TIMEOUT", DEFAULT_SEARCH_TIMEOUT)
    )
    workers = max(1, args.workers if args.workers is not None else _int_env("WORKERS", 4))
    max_bytes = (
        args.max_bytes
        if args.max_bytes is not None
        else _int_env("MAX_FETCH_BYTES", DEFAULT_MAX_FETCH_BYTES)
    )

    image_filters = {
        "imgSize": (args.img_size or os.getenv("IMG_SIZE", "")).strip(),
        "imgType": (args.img_type or os.getenv("IMG_TYPE", "")).strip(),
        "imgColorType": (args.img_color_type or os.getenv("IMG_COLOR_TYPE", "")).strip(),
        "imgDominantColor": (args.img_dominant_color or os.getenv("IMG_DOMINANT_COLOR", "")).strip(),
        "fileType": (args.file_type or os.getenv("FILE_TYPE", "")).strip(),
        "rights": (args.rights or os.getenv("RIGHTS", "")).strip(),
    }
    image_filters = {k: v for k, v in image_filters.items() if v}
    safe = (args.safe or os.getenv("SAFE", "off")).strip() or "off"

    api_endpoint = (args.api_endpoint or os.getenv("API_ENDPOINT", "https://www.googleapis.com/customsearch/v1")).strip()
    output_dir = Path((args.output_dir or os.getenv("OUTPUT_DIR", "output")).strip() or "output")
    run_stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = output_dir / f"run_{run_stamp}"
    image_dir = run_dir / "images"
    manifest_dir = run_dir
    log_file = (args.log_file or os.getenv("LOG_FILE", "image_finder.log")).strip() or "image_finder.log"
    user_agent = (
        args.user_agent
        or os.getenv(
            "USER_AGENT",
            "Mozilla/5.0 (compatible; image-finder/1.0; +https://example.com/bot)",
        )
    ).strip()

    log_path = Path(log_file)
    if not log_path.is_absolute():
        log_path = output_dir / log_path

    return {
        "API_KEY": api_key,
        "CX": cx,
        "API_ENDPOINT": api_endpoint,
        "OUTPUT_DIR": output_dir,
        "RUN_STAMP": run_stamp,
        "IMAGE_DIR": image_dir,
        "MANIFEST_DIR": manifest_dir,
        "LOG_PATH": log_path,
        "USER_AGENT": user_agent,
        "QUERIES": queries,
        "BLOCKED_DOWNLOAD_DOMAINS": blocked_domains,
        "PAGES": pages,
        "DELAY": delay,
        "TIMEOUT": timeout,
        "SEARCH_TIMEOUT": search_timeout,
        "WORKERS": workers,
        "MAX_FETCH_BYTES": max_bytes,
        "IMAGE_FILTERS": image_filters,
        "SAFE": safe,
        "DRY_RUN": args.dry_run,
    }


def _int_or_none(value: Any) -> Optional[int]:
    try:
        return int(value)
    except Exception:
        return None


def search_images(
    session: Session,
    logger: logging.Logger,
    api_key: str,
    cx: str,
    api_endpoint: str,
    query: str,
    pages: int,
    delay: float,
    search_timeout: int,
    image_filters: Dict[str, str],
    safe: str,
) -> Tuple[List[ImageResult], List[SearchError]]:
    logger.info("Starting image search for query: %s (pages=%d)", query, pages)
    results: List[ImageResult] = []
    errors: List[SearchError] = []
    start = 1
    rank = 0

    for page in range(1, pages + 1):
        params = {
            "key": api_key,
            "cx": cx,
            "q": query,
            "searchType": "image",
            "num": RESULTS_PER_PAGE,
            "start": start,
            "safe": safe,
        }
        params.update(image_filters)

        logger.info(
            "Requesting Google CSE image page %d for query '%s' (start=%d)",
            page,
            query,
            start,
        )

        response: Optional[Response] = None
        data: Optional[Dict[str, Any]] = None

        try:
            response = session.get(api_endpoint, params=params, timeout=search_timeout)

            try:
                data = response.json()
            except Exception:
                data = None

            if response.status_code != 200:
                err_type, err_msg, http_status = classify_google_error(response, data, None)
                logger.error(
                    "Search failed for query='%s', page=%d, type=%s, status=%s, message=%s",
                    query,
                    page,
                    err_type,
                    http_status,
                    err_msg,
                )
                errors.append(
                    SearchError(
                        query=query,
                        page_number=page,
                        error_type=err_type,
                        message=err_msg,
                        http_status=http_status,
                    )
                )
                break

            items = (data or {}).get("items", [])
            logger.info("Received %d items for query '%s' on page %d", len(items), query, page)

            for idx, item in enumerate(items, start=1):
                rank += 1
                image_info = item.get("image", {}) or {}
                results.append(
                    ImageResult(
                        query=query,
                        title=item.get("title", ""),
                        link=item.get("link", ""),
                        snippet=item.get("snippet", ""),
                        mime=item.get("mime", ""),
                        file_format=item.get("fileFormat", ""),
                        context_link=image_info.get("contextLink", ""),
                        thumbnail_link=image_info.get("thumbnailLink", ""),
                        thumbnail_width=_int_or_none(image_info.get("thumbnailWidth")),
                        thumbnail_height=_int_or_none(image_info.get("thumbnailHeight")),
                        api_width=_int_or_none(image_info.get("width")),
                        api_height=_int_or_none(image_info.get("height")),
                        api_byte_size=_int_or_none(image_info.get("byteSize")),
                        page_number=page,
                        search_rank=rank,
                        source_rank=idx,
                    )
                )

            next_page = (data or {}).get("queries", {}).get("nextPage", [{}])[0].get("startIndex")
            if not next_page:
                logger.info("No more pages for query '%s'", query)
                break

            start = next_page
            if delay:
                time.sleep(delay)

        except Exception as exc:
            err_type, err_msg, http_status = classify_google_error(response, data, exc)
            logger.error(
                "Search exception for query='%s', page=%d, type=%s, message=%s",
                query,
                page,
                err_type,
                err_msg,
            )
            errors.append(
                SearchError(
                    query=query,
                    page_number=page,
                    error_type=err_type,
                    message=err_msg,
                    http_status=http_status,
                )
            )
            break

    logger.info("Finished search for query '%s' with %d total items", query, len(results))
    return results, errors


def dedupe_results(results: List[ImageResult], logger: logging.Logger) -> List[ImageResult]:
    logger.info("Deduplicating %d results by normalized image link", len(results))
    seen: set[str] = set()
    out: List[ImageResult] = []

    for item in results:
        normalized = normalize_url(item.link)
        if normalized not in seen:
            seen.add(normalized)
            item.link = normalized
            out.append(item)

    logger.info("Deduplication complete: %d unique links", len(out))
    return out


def choose_output_path(out_dir: Path, title_hint: str, url: str, extension: str) -> Path:
    base = safe_filename(title_hint) or guess_filename_from_url(url)
    suffix = short_hash(url, 8)
    filename = f"{base}_{suffix}{extension}"
    return out_dir / filename


def _download_result(
    error: str = "",
    http_status: Optional[int] = None,
    content_type: str = "",
    content_length: Optional[int] = None,
    final_url: str = "",
    sha256: str = "",
    format: str = "",
    width: Optional[int] = None,
    height: Optional[int] = None,
    byte_size: Optional[int] = None,
    data: Optional[bytes] = None,
) -> Dict[str, Any]:
    return {
        "error": error,
        "http_status": http_status,
        "content_type": content_type,
        "content_length": content_length,
        "final_url": final_url,
        "sha256": sha256,
        "format": format,
        "width": width,
        "height": height,
        "byte_size": byte_size,
        "data": data,
    }


def download_image(
    session: Session,
    logger: logging.Logger,
    timeout: int,
    max_bytes: int,
    url: str,
) -> Tuple[bool, Dict[str, Any]]:
    logger.info("Fetching image: url=%s", url)
    request_timeout = (min(DEFAULT_CONNECT_TIMEOUT, timeout), timeout)

    try:
        with session.get(url, stream=True, timeout=request_timeout, allow_redirects=True) as response:
            final_url = response.url
            http_status = response.status_code
            content_type = response.headers.get("Content-Type", "")
            content_length_raw = response.headers.get("Content-Length")
            content_length = int(content_length_raw) if content_length_raw and content_length_raw.isdigit() else None

            meta = dict(
                http_status=http_status,
                content_type=content_type,
                content_length=content_length,
                final_url=final_url,
            )

            if http_status != 200:
                msg = f"HTTP {http_status}"
                logger.warning("Fetch failed (%s) for url=%s", msg, url)
                return False, _download_result(error=msg, **meta)

            if max_bytes and content_length and content_length > max_bytes:
                msg = f"Too large ({content_length} bytes exceeds cap of {max_bytes})"
                logger.warning("Fetch skipped: %s; url=%s", msg, url)
                return False, _download_result(error=msg, **meta)

            chunks: List[bytes] = []
            total = 0
            truncated = False
            for chunk in response.iter_content(chunk_size=8192):
                if not chunk:
                    continue
                chunks.append(chunk)
                total += len(chunk)
                if max_bytes and total > max_bytes:
                    truncated = True
                    break

            raw = b"".join(chunks)
            if not raw:
                msg = "Empty response body"
                logger.warning("Fetch failed (%s) for url=%s", msg, url)
                return False, _download_result(error=msg, **meta)

            if truncated:
                msg = f"Too large (exceeds cap of {max_bytes} bytes)"
                logger.warning("Fetch skipped: %s; url=%s", msg, url)
                return False, _download_result(error=msg, **meta)

            sniffed = sniff_image_format(raw)
            declared = CONTENT_TYPE_FORMATS.get((content_type or "").split(";")[0].strip().lower(), "")
            fmt = sniffed or declared

            if not fmt:
                base_type = (content_type or "unknown").split(";")[0].strip()
                msg = f"Not an image (Content-Type={base_type or 'unknown'})"
                logger.warning("Fetch skipped: %s; url=%s", msg, url)
                return False, _download_result(error=msg, **meta)

            sha256_hex = hashlib.sha256(raw).hexdigest()
            dims = image_dimensions(raw, fmt)
            width, height = dims if dims else (None, None)

            logger.info(
                "Fetch succeeded: url=%s (%s, %d bytes%s)",
                url,
                fmt,
                total,
                f", {width}x{height}" if width else "",
            )
            return True, _download_result(
                sha256=sha256_hex,
                format=fmt,
                width=width,
                height=height,
                byte_size=total,
                data=raw,
                **meta,
            )

    except Exception as exc:
        logger.error("Exception while fetching url=%s: %s", url, exc)
        return False, _download_result(error=str(exc))


def write_image_file(out_dir: Path, item: ImageResult, data: bytes) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    extension = IMAGE_EXTENSIONS.get(item.format, ".img")
    path = choose_output_path(out_dir, item.title, item.link, extension)

    with open(path, "wb") as f:
        f.write(data)

    return path


def update_runs_index(output_dir: Path, logger: logging.Logger) -> None:
    runs: List[Dict[str, Any]] = []

    for info_path in output_dir.glob("*/run_info.json"):
        try:
            with open(info_path, encoding="utf-8") as f:
                info = json.load(f)
            info["dir"] = info_path.parent.name
            runs.append(info)
        except Exception as exc:
            logger.warning("Skipping unreadable run info %s: %s", info_path, exc)

    runs.sort(key=lambda r: r.get("generated_at", ""), reverse=True)

    index_path = output_dir / "runs.json"
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(
            {"generated_at": utc_now_iso(), "runs": runs},
            f,
            indent=2,
            ensure_ascii=False,
        )

    logger.info("Saved runs index: %s", index_path)


def save_manifest(
    logger: logging.Logger,
    config: Dict[str, Any],
    data: List[ImageResult],
    search_errors: List[SearchError],
) -> None:
    manifest_dir = config["MANIFEST_DIR"]
    run_stamp = config["RUN_STAMP"]
    manifest_dir.mkdir(parents=True, exist_ok=True)

    json_path = manifest_dir / f"image_results_{run_stamp}.json"
    csv_path = manifest_dir / f"image_results_{run_stamp}.csv"
    text_path = manifest_dir / f"image_results_{run_stamp}.txt"
    errors_path = manifest_dir / f"search_errors_{run_stamp}.json"

    summary = {
        "generated_at": utc_now_iso(),
        "total_results": len(data),
        "downloaded": sum(1 for x in data if x.status == "downloaded"),
        "skipped": sum(1 for x in data if x.status == "skipped"),
        "total_bytes": sum(x.byte_size or 0 for x in data),
        "search_error_count": len(search_errors),
    }

    payload = {
        "summary": summary,
        "results": [asdict(row) for row in data],
    }

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    run_info = {
        "id": manifest_dir.name,
        "generated_at": summary["generated_at"],
        "manifest": json_path.name,
        "errors": errors_path.name,
        "queries": list(config["QUERIES"]),
        "summary": summary,
    }
    run_info_path = manifest_dir / "run_info.json"
    with open(run_info_path, "w", encoding="utf-8") as f:
        json.dump(run_info, f, indent=2, ensure_ascii=False)

    fields = [
        "query",
        "title",
        "link",
        "snippet",
        "mime",
        "file_format",
        "context_link",
        "thumbnail_link",
        "api_width",
        "api_height",
        "api_byte_size",
        "page_number",
        "search_rank",
        "source_rank",
        "status",
        "saved_as",
        "error",
        "http_status",
        "content_type",
        "content_length",
        "fetched_at",
        "sha256",
        "final_url",
        "format",
        "width",
        "height",
        "byte_size",
    ]

    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in data:
            writer.writerow({k: getattr(row, k) for k in fields})

    with open(errors_path, "w", encoding="utf-8") as f:
        json.dump([asdict(err) for err in search_errors], f, indent=2, ensure_ascii=False)

    downloaded_rows = [row for row in data if row.status == "downloaded"]
    with open(text_path, "w", encoding="utf-8") as f:
        f.write("Downloaded images\n")
        f.write(f"Generated: {summary['generated_at']}\n")
        f.write(
            f"Images: {len(downloaded_rows)}  Total bytes: {sum(r.byte_size or 0 for r in downloaded_rows)}\n"
        )
        for row in downloaded_rows:
            f.write("\n")
            f.write("=" * 80 + "\n")
            f.write(f"Title: {row.title}\n")
            f.write(f"Image URL: {row.link}\n")
            f.write(f"Page URL: {row.context_link}\n")
            f.write(f"Query: {row.query}\n")
            f.write(
                f"Format: {row.format}  Dimensions: {row.width or '?'}x{row.height or '?'}  "
                f"Bytes: {row.byte_size or 0}\n"
            )
            f.write(f"Saved as: {row.saved_as}\n")

    logger.info("Saved manifest JSON: %s", json_path)
    logger.info("Saved manifest CSV: %s", csv_path)
    logger.info("Saved image listing: %s", text_path)
    logger.info("Saved search errors JSON: %s", errors_path)
    logger.info("Saved run info: %s", run_info_path)

    update_runs_index(config["OUTPUT_DIR"], logger)


def run_searches(
    session: Session,
    logger: logging.Logger,
    config: Dict[str, Any],
) -> Tuple[List[ImageResult], List[SearchError]]:
    all_results: List[ImageResult] = []
    search_errors: List[SearchError] = []

    for q in config["QUERIES"]:
        logger.info("[search] %s", q)

        hits, errs = search_images(
            session=session,
            logger=logger,
            api_key=config["API_KEY"],
            cx=config["CX"],
            api_endpoint=config["API_ENDPOINT"],
            query=q,
            pages=config["PAGES"],
            delay=config["DELAY"],
            search_timeout=config["SEARCH_TIMEOUT"],
            image_filters=config["IMAGE_FILTERS"],
            safe=config["SAFE"],
        )

        all_results.extend(hits)
        search_errors.extend(errs)

        logger.info("  -> %d results", len(hits))
        for err in errs:
            logger.warning("  -> search error [%s]: %s", err.error_type, err.message)

    return all_results, search_errors


def run_downloads(
    session: Session,
    logger: logging.Logger,
    config: Dict[str, Any],
    all_results: List[ImageResult],
) -> None:
    total = len(all_results)
    out_dir = config["IMAGE_DIR"]
    timeout = config["TIMEOUT"]
    delay = config["DELAY"]
    workers = config["WORKERS"]
    max_bytes = config["MAX_FETCH_BYTES"]
    blocked_domains = config["BLOCKED_DOWNLOAD_DOMAINS"]

    def process(item: ImageResult) -> None:
        if is_blocked_domain(item.link, blocked_domains):
            blocked_host = extract_hostname(item.link)
            item.status = "skipped"
            item.error = f"Blocked domain: {blocked_host}"
            item.fetched_at = utc_now_iso()
            logger.info("Skipped blocked domain: url=%s, hostname=%s", item.link, blocked_host)
            return

        if delay:
            time.sleep(delay)

        ok, info = download_image(
            session=session,
            logger=logger,
            timeout=timeout,
            max_bytes=max_bytes,
            url=item.link,
        )

        item.http_status = info.get("http_status")
        item.content_type = info.get("content_type", "")
        item.content_length = info.get("content_length")
        item.final_url = info.get("final_url", "")
        item.sha256 = info.get("sha256", "")
        item.format = info.get("format", "")
        item.width = info.get("width")
        item.height = info.get("height")
        item.byte_size = info.get("byte_size")
        item.fetched_at = utc_now_iso()

        if item.width is None and item.api_width is not None:
            item.width = item.api_width
            item.height = item.api_height

        if ok:
            item.status = "downloaded"
            item.saved_as = str(write_image_file(out_dir, item, info["data"]))
        else:
            item.status = "skipped"
            item.error = info.get("error", "")

    def log_progress(done: int, item: ImageResult) -> None:
        detail = item.saved_as if item.status == "downloaded" else item.error
        logger.info("[%d/%d] %s: %s (%s)", done, total, item.status, item.link, detail)

    if workers > 1 and total > 1:
        logger.info("Downloading with %d concurrent workers", workers)
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(process, item): item for item in all_results}
            for done, future in enumerate(as_completed(futures), start=1):
                item = futures[future]
                try:
                    future.result()
                except Exception as exc:
                    item.status = "skipped"
                    item.error = str(exc)
                    item.fetched_at = utc_now_iso()
                    logger.error("Download task error: url=%s: %s", item.link, exc)
                log_progress(done, item)
    else:
        for done, item in enumerate(all_results, start=1):
            process(item)
            log_progress(done, item)


def print_summary(
    logger: logging.Logger,
    config: Dict[str, Any],
    all_results: List[ImageResult],
    search_errors: List[SearchError],
) -> None:
    downloaded_count = sum(1 for x in all_results if x.status == "downloaded")
    skipped_count = sum(1 for x in all_results if x.status == "skipped")

    logger.info(
        "Summary: total=%d downloaded=%d skipped=%d search_errors=%d",
        len(all_results),
        downloaded_count,
        skipped_count,
        len(search_errors),
    )
    logger.info("Image files saved in: %s", config["IMAGE_DIR"].resolve())
    logger.info("=== Run finished ===\n")


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()
    config = load_config(args)

    logger = setup_logger(config["LOG_PATH"])
    session = build_session(config["USER_AGENT"])

    logger.info("=== Run started ===")
    logger.info("Queries: %s", config["QUERIES"])
    logger.info("Blocked download domains: %s", config["BLOCKED_DOWNLOAD_DOMAINS"])
    logger.info("Image filters: %s", config["IMAGE_FILTERS"])
    logger.info("Output directory: %s", config["OUTPUT_DIR"].resolve())
    logger.info("Image files directory: %s", config["IMAGE_DIR"].resolve())
    logger.info("Log file: %s", config["LOG_PATH"].resolve())
    logger.info("Workers: %d", config["WORKERS"])
    logger.info("Dry run: %s", config["DRY_RUN"])

    all_results, search_errors = run_searches(session, logger, config)

    all_results = dedupe_results(all_results, logger)
    logger.info("[dedupe] %d unique links", len(all_results))

    if not config["DRY_RUN"]:
        run_downloads(session, logger, config, all_results)
    else:
        logger.info("Dry run enabled; skipping image downloads.")
        for item in all_results:
            item.status = "not_downloaded"

    save_manifest(
        logger=logger,
        config=config,
        data=all_results,
        search_errors=search_errors,
    )

    print_summary(logger, config, all_results, search_errors)


if __name__ == "__main__":
    main()
