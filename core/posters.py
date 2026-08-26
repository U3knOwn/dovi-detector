# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Finding a cached poster on disk, safely.

The web interface and the API both hand these files out, so the name check
lives here rather than in either of them: a caller only ever receives a path
that is inside the cache directory.
"""
import os
import re

import config

# Pillow is optional: without it a poster is served at its own size, which is
# what happened before thumbnails existed. Only the sizes below are produced,
# so the cache cannot grow a variant per pixel a caller thinks of.
try:
    from PIL import Image
    THUMBNAILS_AVAILABLE = True
except ImportError:
    THUMBNAILS_AVAILABLE = False

POSTER_WIDTHS = (160, 320, 480, 640)

# A cached poster is named by the scanner itself - a TMDB id or a URL hash, plus
# the extension. Anything else is not a poster name, and in particular cannot be
# a path.
POSTER_NAME = re.compile(r'^[a-zA-Z0-9_-]+\.jpg$')


def cached_poster_path(filename):
    """
    The absolute path of a cached poster, or None when the name is not one.

    None means "this is not a poster file name" - not "it does not exist";
    whether the file is there is the caller's to check, as the two cases are
    reported differently.
    """
    if not filename or not POSTER_NAME.match(filename):
        return None

    # Belt and braces behind the pattern above: resolve the path and confirm it
    # really is inside the cache directory.
    cache_dir = os.path.abspath(config.POSTER_CACHE_DIR)
    path = os.path.abspath(os.path.join(cache_dir, filename))
    if os.path.commonpath([cache_dir, path]) != cache_dir:
        return None

    return path


def poster_name_from_url(poster_url):
    """
    The cached file name a ``poster_url`` points at, or None.

    An entry's ``poster_url`` is ``/poster/<name>.jpg`` once the image has been
    cached, and the original remote URL when it could not be - only the first
    case names a file this server can serve.
    """
    if not isinstance(poster_url, str) or not poster_url.startswith('/poster/'):
        return None
    return poster_url[len('/poster/'):]


def _thumbnail_path(filename, width):
    """Where the resized copy of a poster lives."""
    return os.path.join(config.POSTER_CACHE_DIR, 'thumbs', str(width), filename)


def poster_path_at_width(filename, width):
    """
    A cached poster at the requested width, resized on first use.

    Returns the original's path when no width is asked for, when the width is
    not one this produces, when Pillow is not installed, or when the resize
    fails - a list that renders slightly heavier pictures beats a list with
    holes in it. Returns None when the name is not a poster name at all.
    """
    original = cached_poster_path(filename)
    if original is None or not width:
        return original

    if not THUMBNAILS_AVAILABLE or width not in POSTER_WIDTHS:
        return original

    thumbnail = _thumbnail_path(filename, width)
    if os.path.exists(thumbnail):
        return thumbnail

    if not os.path.exists(original):
        return original

    try:
        os.makedirs(os.path.dirname(thumbnail), exist_ok=True)
        with Image.open(original) as image:
            # Already smaller than asked for: nothing to gain from a copy.
            if image.width <= width:
                return original
            height = round(image.height * width / image.width)
            image.convert('RGB').resize((width, height), Image.LANCZOS).save(
                thumbnail, 'JPEG', quality=82, optimize=True)
    except Exception as e:
        print(f"Could not resize poster {filename} to {width}px: {e}")
        return original

    return thumbnail


def delete_poster_thumbnails(filename):
    """Drop every resized copy of a poster, e.g. when the entry goes."""
    for width in POSTER_WIDTHS:
        try:
            os.unlink(_thumbnail_path(filename, width))
        except OSError:
            pass
