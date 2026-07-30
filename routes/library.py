# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
The library page and the entries it renders.

/api/library is what the page itself fetches and is free to change with it;
other services should use /api/v1/library, which is kept stable.
"""
import os

from flask import Blueprint, jsonify, render_template

import config
from core import library_ops

bp = Blueprint('library', __name__)

# The page's ES modules, for the preload hints in the template. Read from disk
# rather than listed by hand, so the hints cannot name a file that is gone (a
# 404 per page load) or miss one that was added. Kept after the first read: the
# set only changes when the files in the static directory do, and those are
# picked up at startup anyway.
_js_modules = None


def js_modules():
    """Every ES module under the static directory, as static-relative paths."""
    global _js_modules
    if _js_modules is not None:
        return _js_modules

    static_dir = config.get_static_dir()
    js_dir = os.path.join(static_dir, 'js')
    modules = []
    for root, _dirs, files in os.walk(js_dir):
        for name in files:
            if name.endswith('.js'):
                relative = os.path.relpath(os.path.join(root, name), static_dir)
                modules.append(relative.replace(os.sep, '/'))

    _js_modules = sorted(modules)
    return _js_modules


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
        js_modules=js_modules())


@bp.route('/api/library', methods=['GET'])
def api_library():
    """The scanned entries the library page renders, as JSON."""
    return jsonify({'success': True, 'files': library_ops.list_entries()})
