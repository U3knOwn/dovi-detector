# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Changing single entries: deleting, re-scanning, and emptying the database.

These are the endpoints the web interface talks to; the versioned API in
api_v1.py offers the same operations to other services. Both go through
core/library_ops.py, so they cannot drift apart.
"""
from flask import Blueprint, jsonify, request

from core import library_ops
from utils.i18n import get_request_language, translate

bp = Blueprint('entries', __name__)


@bp.route('/clear_database', methods=['POST'])
def clear_database():
    """Clear the entire scanned_files database (and cached posters)."""
    try:
        library_ops.clear_library()
        return jsonify({'success': True, 'total_files': 0})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/delete_entry', methods=['POST'])
def delete_entry():
    """Delete a single entry from the scanned files database."""
    lang = 'en'
    try:
        lang = get_request_language(request)
        data = request.get_json()
        file_path = data.get('file_path')

        if not file_path:
            return jsonify({'success': False, 'error': translate('api_no_file_path_provided', lang)}), 400

        if not library_ops.delete_entry(file_path):
            return jsonify({'success': False, 'error': translate('api_file_not_found', lang)}), 404

        return jsonify({'success': True, 'total_files': library_ops.entry_count()})
    except Exception as e:
        print(f"Error in delete_entry: {e}")
        return jsonify({'success': False, 'error': translate('delete_entry_error', lang)}), 500


@bp.route('/rescan_entry', methods=['POST'])
def rescan_entry():
    """
    Re-read a single entry from scratch: probe the file again and redo every
    online lookup. Used by the dialog's "re-scan" button when an entry is
    stale or was scanned while an API was unavailable.
    """
    lang = 'en'
    try:
        lang = get_request_language(request)
        data = request.get_json()
        file_path = data.get('file_path')

        if not file_path:
            return jsonify({'success': False, 'error': translate('api_no_file_path_provided', lang)}), 400

        try:
            file_info = library_ops.rescan_entry(file_path)
        except FileNotFoundError:
            return jsonify({'success': False, 'error': translate('api_file_not_found', lang)}), 404

        if file_info is None:
            return jsonify({'success': False, 'error': translate('rescan_entry_error', lang)}), 500

        return jsonify({
            'success': True,
            'message': translate('api_file_scanned_successfully', lang),
            'file_info': file_info
        })
    except Exception as e:
        print(f"Error in rescan_entry: {e}")
        return jsonify({'success': False, 'error': translate('rescan_entry_error', lang)}), 500
