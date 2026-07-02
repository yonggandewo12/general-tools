#!/usr/bin/env python3
"""
Agnes AI Image Generation Backend

Generates images via Agnes AI's OpenAI-compatible API.
Supports both text-to-image and image-to-image generation.
Used by image_gen.py as a backend module.

Configuration keys:
  AGNES_API_KEY   (required) API key
  AGNES_BASE_URL  (optional) Custom API endpoint (default: https://apihub.agnes-ai.com/v1)
  AGNES_MODEL     (optional) Model name (default: agnes-image-2.1-flash)

Dependencies:
  pip install requests Pillow
"""

import sys
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from console_encoding import configure_utf8_stdio  # noqa: E402

configure_utf8_stdio()

if __name__ == "__main__":
    print(__doc__)
    print("Use via: python3 skills/ppt-master/scripts/image_gen.py \"prompt\" --backend agnes")
    raise SystemExit(0 if any(arg in {"-h", "--help", "help"} for arg in sys.argv[1:]) else 1)

import base64
import os
import time
import threading

import requests
from image_backends.backend_common import (
    MAX_RETRIES,
    download_image,
    http_error,
    is_rate_limit_error,
    normalize_image_size,
    resolve_output_path,
    retry_delay,
    save_image_bytes,
)


# ╔══════════════════════════════════════════════════════════════════╗
# ║  Constants                                                      ║
# ╚══════════════════════════════════════════════════════════════════╝

DEFAULT_BASE_URL = "https://apihub.agnes-ai.com/v1"
DEFAULT_MODEL = "agnes-image-2.1-flash"

# Aspect ratio -> size mapping for Agnes AI models.
# Agnes uses OpenAI-compatible size format (WIDTHxHEIGHT).
ASPECT_RATIO_TO_SIZE = {
    "1:1":  "1024x1024",
    "16:9": "1792x1024",
    "9:16": "1024x1792",
    "3:2":  "1536x1024",
    "2:3":  "1024x1536",
    "4:3":  "1536x1024",
    "3:4":  "1024x1536",
    "4:5":  "1024x1024",
    "5:4":  "1024x1024",
    "21:9": "1792x1024",
}

IMAGE_SIZE_TO_SIZE = {
    "512px": {
        "1:1": "512x512", "16:9": "768x432", "9:16": "432x768",
        "3:2": "640x427", "2:3": "427x640", "4:3": "640x480",
        "3:4": "480x640", "4:5": "512x640", "5:4": "640x512",
        "21:9": "768x341",
    },
    "1K": {
        "1:1": "1024x1024", "16:9": "1792x1024", "9:16": "1024x1792",
        "3:2": "1536x1024", "2:3": "1024x1536", "4:3": "1536x1024",
        "3:4": "1024x1536", "4:5": "1024x1024", "5:4": "1024x1024",
        "21:9": "1792x1024",
    },
    "2K": {
        "1:1": "2048x2048", "16:9": "2560x1440", "9:16": "1440x2560",
        "3:2": "2048x1365", "2:3": "1365x2048", "4:3": "2048x1536",
        "3:4": "1536x2048", "4:5": "1600x2000", "5:4": "2000x1600",
        "21:9": "2560x1097",
    },
    "4K": {
        "1:1": "4096x4096", "16:9": "3840x2160", "9:16": "2160x3840",
        "3:2": "3840x2560", "2:3": "2560x3840", "4:3": "3840x2880",
        "3:4": "2880x3840", "4:5": "3200x4000", "5:4": "4000x3200",
        "21:9": "3840x1646",
    },
}


def _select_size(aspect_ratio: str, image_size: str) -> str:
    """Select a size string based on aspect ratio and image size tier."""
    size_table = IMAGE_SIZE_TO_SIZE.get(image_size)
    if size_table and aspect_ratio in size_table:
        return size_table[aspect_ratio]
    # Fallback to legacy mapping
    if aspect_ratio in ASPECT_RATIO_TO_SIZE:
        return ASPECT_RATIO_TO_SIZE[aspect_ratio]
    raise ValueError(
        f"Unsupported aspect ratio '{aspect_ratio}' for Agnes backend. "
        f"Supported: {list(ASPECT_RATIO_TO_SIZE.keys())}"
    )


def _image_generations_url(base_url: str | None) -> str:
    base = (base_url or DEFAULT_BASE_URL).rstrip("/")
    if base.endswith("/images/generations"):
        return base
    return f"{base}/images/generations"


# ╔══════════════════════════════════════════════════════════════════╗
# ║  Image Generation                                               ║
# ╚══════════════════════════════════════════════════════════════════╝

def _generate_image(api_key: str, prompt: str,
                    aspect_ratio: str = "1:1", image_size: str = "1K",
                    output_dir: str = None, filename: str = None,
                    model: str = DEFAULT_MODEL, base_url: str = None,
                    reference_image: str = None) -> str:
    """
    Image generation via Agnes AI API.

    Supports text-to-image (default) and image-to-image (when reference_image is provided).

    Returns:
        Path of the saved image file

    Raises:
        RuntimeError: When generation fails
    """
    size = _select_size(aspect_ratio, image_size)

    request = {
        "model": model,
        "prompt": prompt,
        "size": size,
        "n": 1,
        "return_base64": True,
    }

    # Image-to-image mode: pass reference image via extra_body
    if reference_image:
        request["extra_body"] = {
            "image": [reference_image],
        }
        mode_label = "image-to-image"
    else:
        mode_label = "text-to-image"

    print(f"[Agnes AI - {base_url or DEFAULT_BASE_URL}]")
    print(f"  Mode:         {mode_label}")
    print(f"  Model:        {model}")
    print(f"  Prompt:       {prompt[:120]}{'...' if len(prompt) > 120 else ''}")
    print(f"  Size:         {size} (from aspect_ratio={aspect_ratio}, image_size={image_size})")
    if reference_image:
        print(f"  Ref Image:    {reference_image[:120]}{'...' if len(reference_image) > 120 else ''}")
    print()

    start_time = time.time()
    print(f"  [..] Generating...", end="", flush=True)

    # Heartbeat thread
    heartbeat_stop = threading.Event()

    def _heartbeat():
        while not heartbeat_stop.is_set():
            heartbeat_stop.wait(5)
            if not heartbeat_stop.is_set():
                elapsed = time.time() - start_time
                print(f" {elapsed:.0f}s...", end="", flush=True)

    hb_thread = threading.Thread(target=_heartbeat, daemon=True)
    hb_thread.start()

    try:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        response = requests.post(
            _image_generations_url(base_url),
            headers=headers,
            json=request,
            timeout=300,
        )
        if not response.ok:
            raise http_error(response, "Agnes AI image generation")
        try:
            resp = response.json()
        except ValueError as exc:
            raise RuntimeError("Agnes AI returned invalid JSON.") from exc
    finally:
        heartbeat_stop.set()
        hb_thread.join(timeout=1)

    elapsed = time.time() - start_time
    print(f"\n  [DONE] Image generated ({elapsed:.1f}s)")

    data = resp.get("data")
    if data and len(data) > 0:
        first_image = data[0]
        b64_json = first_image.get("b64_json")
        image_url = first_image.get("url")

        path = resolve_output_path(prompt, output_dir, filename, ".png")

        if b64_json:
            image_data = base64.b64decode(b64_json)
            return save_image_bytes(image_data, path)
        if image_url:
            return download_image(image_url, path)

    raise RuntimeError("No image was generated. The server may have refused the request.")


# ╔══════════════════════════════════════════════════════════════════╗
# ║  Public Entry Point                                             ║
# ╚══════════════════════════════════════════════════════════════════╝

def generate(prompt: str,
             aspect_ratio: str = "1:1", image_size: str = "1K",
             output_dir: str = None, filename: str = None,
             model: str = None, max_retries: int = MAX_RETRIES,
             reference_image: str = None) -> str:
    """
    Agnes AI image generation with automatic retry.

    Reads credentials from the current process environment or a `.env` file:
      AGNES_API_KEY
      AGNES_BASE_URL (optional)
      AGNES_MODEL (optional override)

    Args:
        prompt: Prompt text
        aspect_ratio: Aspect ratio, mapped to size
        image_size: Image size tier (512px, 1K, 2K, 4K)
        output_dir: Output directory
        filename: Output filename (without extension)
        model: Model name (default: agnes-image-2.1-flash)
        max_retries: Maximum number of retries
        reference_image: Reference image URL for image-to-image generation

    Returns:
        Path of the saved image file
    """
    api_key = os.environ.get("AGNES_API_KEY")
    if not api_key:
        raise ValueError(
            "No API key found. Set AGNES_API_KEY in the current environment or a .env file."
        )

    base_url = os.environ.get("AGNES_BASE_URL") or DEFAULT_BASE_URL
    resolved_model = model or os.environ.get("AGNES_MODEL") or DEFAULT_MODEL
    image_size = normalize_image_size(image_size)

    last_error = None
    for attempt in range(max_retries + 1):
        try:
            return _generate_image(
                api_key=api_key, prompt=prompt,
                aspect_ratio=aspect_ratio, image_size=image_size,
                output_dir=output_dir, filename=filename,
                model=resolved_model, base_url=base_url,
                reference_image=reference_image,
            )
        except Exception as e:
            last_error = e
            if attempt < max_retries and is_rate_limit_error(e):
                delay = retry_delay(attempt, rate_limited=True)
                print(f"\n  [WARN] Rate limit hit (attempt {attempt + 1}/{max_retries + 1}). "
                      f"Waiting {delay}s before retry...")
                time.sleep(delay)
            elif attempt < max_retries:
                delay = retry_delay(attempt, rate_limited=False)
                print(f"\n  [WARN] Error (attempt {attempt + 1}/{max_retries + 1}): {e}. "
                      f"Retrying in {delay}s...")
                time.sleep(delay)
            else:
                break

    raise RuntimeError(f"Failed after {max_retries + 1} attempts. Last error: {last_error}")
