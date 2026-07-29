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
