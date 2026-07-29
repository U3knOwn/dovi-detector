# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
The library page and the entries it renders.
"""
import os

from flask import Blueprint, jsonify, render_template

import config
from services import database

bp = Blueprint('library', __name__)


# The fields the library view needs. Everything else an entry carries (the
# raw DV profile, the IMDb vote count) is not rendered anywhere, so it is not
# shipped to every visitor either.
LIBRARY_FIELDS = (
    'filename', 'path', 'hdr_format', 'hdr_detail', 'el_type', 'resolution',
    'audio_codec', 'duration', 'video_bitrate', 'audio_bitrate', 'file_size',
    'mtime', 'dv_cm_version', 'hdr_metadata', 'tmdb_id', 'poster_url',
    'tmdb_title', 'tmdb_year', 'tmdb_rating', 'tmdb_plot', 'tmdb_directors',
    'tmdb_cast', 'tmdb_genres', 'imdb_id', 'imdb_rating', 'rt_rating',
    'metacritic', 'imdb_top250',
)


def _library_entries():
    """
    The library as the page consumes it: one compact record per entry.

    Snapshotted under the lock, because a scan or the watcher may be mutating
    the database right now and iterating it while it changes size raises.
    """
    with database.scan_lock:
        snapshot = list(database.scanned_files.values())

    entries = []
    for file_info in snapshot:
        entry = {field: file_info.get(field) for field in LIBRARY_FIELDS}

        # Modification time for the "recently added" sort. Scanning records it,
        # so only entries from an older database still need a stat call here -
        # which matters on a large library, where thousands of stats on network
        # storage would otherwise be paid on every page load.
        if not entry.get('mtime'):
            try:
                entry['mtime'] = os.path.getmtime(entry.get('path') or '')
            except (OSError, TypeError):
                entry['mtime'] = 0

        entries.append(entry)

    entries.sort(key=lambda x: x.get('filename') or '')
    return entries


@bp.route('/')
def index():
    """
    Main page.

    Only the shell is rendered; the table itself is filled from
    /api/library and only the rows in view are put into the DOM. Rendering
    every entry server-side meant megabytes of markup and tens of thousands of
    DOM nodes for a large library, which no amount of compression fixes.
    """
    with database.scan_lock:
        file_count = len(database.scanned_files)

    return render_template(
        'index.html',
        file_count=file_count,
        auto_refresh_interval=config.AUTO_REFRESH_INTERVAL)


@bp.route('/api/library', methods=['GET'])
def api_library():
    """The scanned entries the library page renders, as JSON."""
    return jsonify({'success': True, 'files': _library_entries()})
