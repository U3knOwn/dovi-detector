# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
The library page and the entries it renders.

/api/library is what the page itself fetches and is free to change with it;
other services should use /api/v1/library, which is kept stable.
"""
from flask import Blueprint, jsonify, render_template

import config
from core import library_ops

bp = Blueprint('library', __name__)


@bp.route('/')
def index():
    """
    Main page.

    Only the shell is rendered; the table itself is filled from
    /api/library and only the rows in view are put into the DOM. Rendering
    every entry server-side meant megabytes of markup and tens of thousands of
    DOM nodes for a large library, which no amount of compression fixes.
    """
    return render_template(
        'index.html',
        file_count=library_ops.entry_count(),
        auto_refresh_interval=config.AUTO_REFRESH_INTERVAL)


@bp.route('/api/library', methods=['GET'])
def api_library():
    """The scanned entries the library page renders, as JSON."""
    return jsonify({'success': True, 'files': library_ops.list_entries()})
