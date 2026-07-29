# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Serving the cached poster images.
"""
import os
import re

from flask import Blueprint, send_file

import config

bp = Blueprint('posters', __name__)


@bp.route('/poster/<filename>')
def serve_poster(filename):
    """Serve cached poster images"""
    try:
        # Validate filename to prevent path traversal attacks
        # Only allow alphanumeric, underscore, hyphen, and .jpg extension
        if not re.match(r'^[a-zA-Z0-9_-]+\.jpg$', filename):
            print(f"Invalid poster filename: {filename}")
            return "Invalid filename", 400

        # Prevent directory traversal
        if '..' in filename or '/' in filename or '\\' in filename:
            print(f"Path traversal attempt detected: {filename}")
            return "Invalid filename", 400

        backdrop_path = os.path.join(config.POSTER_CACHE_DIR, filename)

        # Verify the resolved path is still within POSTER_CACHE_DIR
        if not os.path.abspath(backdrop_path).startswith(
                os.path.abspath(config.POSTER_CACHE_DIR)):
            print(f"Path traversal attempt detected: {filename}")
            return "Invalid filename", 400

        if os.path.exists(backdrop_path):
            return send_file(backdrop_path, mimetype='image/jpeg')
        else:
            return "Poster not found", 404
    except Exception as e:
        print(f"Error serving poster {filename}: {e}")
        return "Error serving poster", 500
