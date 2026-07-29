# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Gzip compression of the responses.
"""
import gzip

from flask import request


# Content types worth compressing. Posters are already-compressed JPEGs and
# would only get bigger, so they are deliberately absent.
_COMPRESSIBLE_TYPES = {
    'text/html', 'text/css', 'text/plain', 'text/javascript',
    'application/javascript', 'application/json', 'image/svg+xml',
}

# Below this, the gzip header costs more than the compression saves.
_COMPRESS_MIN_BYTES = 1024


def compress_response(response):
    """
    Gzip text responses when the client accepts it.

    The library page is server-rendered markup that repeats the same attribute
    names on every row, so it compresses by well over 20x - on a 5000 entry
    library that is the difference between a ~25 MB and a ~1 MB page. Streamed responses (the SSE endpoint, send_file) are passed
    through untouched.
    """
    if response.direct_passthrough or response.status_code != 200:
        return response
    if 'Content-Encoding' in response.headers:
        return response
    if (response.content_type or '').split(';')[0].strip() not in _COMPRESSIBLE_TYPES:
        return response
    if 'gzip' not in request.headers.get('Accept-Encoding', '').lower():
        return response

    try:
        data = response.get_data()
    except RuntimeError:
        # Not buffered (streaming response) - nothing to compress
        return response

    if len(data) < _COMPRESS_MIN_BYTES:
        return response

    # Level 6 is the usual sweet spot: nearly the ratio of 9 at a fraction of
    # the CPU, which matters when the payload is megabytes of markup.
    response.set_data(gzip.compress(data, 6))
    response.headers['Content-Encoding'] = 'gzip'
    response.headers['Content-Length'] = response.content_length
    response.vary.add('Accept-Encoding')
    return response


def register_compression(app):
    """Compress every text response this app sends."""
    app.after_request(compress_response)
