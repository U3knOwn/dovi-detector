# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Serving the cached poster images.
"""
import os

from flask import Blueprint, send_file

from core.posters import cached_poster_path

bp = Blueprint('posters', __name__)


@bp.route('/poster/<filename>')
def serve_poster(filename):
    """
    Serve a cached poster image.

    This is what an entry's ``poster_url`` points at; the API offers the same
    files under /api/v1/posters/<filename>. The name check both share lives in
    core/posters.py.
    """
    try:
        poster_path = cached_poster_path(filename)
        if poster_path is None:
            print(f"Invalid poster filename: {filename}")
            return "Invalid filename", 400

        if os.path.exists(poster_path):
            return send_file(poster_path, mimetype='image/jpeg')
        else:
            return "Poster not found", 404
    except Exception as e:
        print(f"Error serving poster {filename}: {e}")
        return "Error serving poster", 500
