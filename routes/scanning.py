# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Starting scans and following their progress.

These are the endpoints the web interface talks to; the versioned API in
api_v1.py offers the same operations to other services. Both go through
core/library_ops.py, so they cannot drift apart.
"""
from flask import Blueprint, jsonify, request

from core import library_ops
from core.scan_state import scan_state, scan_state_lock
from utils.i18n import get_request_language, translate

bp = Blueprint('scanning', __name__)


@bp.route('/scan', methods=['POST'])
def manual_scan():
    """Endpoint for manual scan trigger - runs scan in background with progress updates"""
    library_ops.start_full_scan()
    return jsonify({'success': True, 'message': 'Scan started'})


@bp.route('/get_files', methods=['GET'])
def get_files():
    """Get list of available video files for dropdown selection"""
    try:
        return jsonify({
            'success': True,
            'files': library_ops.list_media_files()
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@bp.route('/scan_file', methods=['POST'])
def scan_single_file():
    """Endpoint to scan a specific file"""
    try:
        # Get user's preferred language
        lang = get_request_language(request)

        data = request.get_json()
        file_path = data.get('file_path')

        if not file_path:
            return jsonify({
                'success': False,
                'error': translate('api_no_file_path_provided', lang)
            }), 400

        try:
            result = library_ops.scan_file(file_path)
        except FileNotFoundError:
            return jsonify({
                'success': False,
                'error': translate('api_file_not_found', lang)
            }), 404

        if result and result.get('success'):
            return jsonify({
                'success': True,
                'message': translate('api_file_scanned_successfully', lang),
                'file_info': result.get('file_info')
            })
        else:
            return jsonify({
                'success': False,
                'message': translate('api_file_not_profile_or_scanned', lang)
            })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@bp.route('/scan_files', methods=['POST'])
def scan_multiple_files():
    """Scan a user-selected set of files in the background with progress updates.

    Mirrors the progress protocol of /scan (via publish_scan_progress) so the
    existing SSE handler drives the progress bar. Already-scanned files are
    skipped by scan_video_file, so selecting everything effectively scans only
    what is still missing.
    """
    data = request.get_json(silent=True) or {}
    file_paths = data.get('file_paths', [])

    if not isinstance(file_paths, list) or not file_paths:
        lang = get_request_language(request)
        return jsonify({
            'success': False,
            'error': translate('api_no_file_path_provided', lang)
        }), 400

    library_ops.start_scan_of(file_paths)
    return jsonify({'success': True, 'message': 'Scan started'})


@bp.route('/scan_status', methods=['GET'])
def scan_status():
    """
    Current scan progress, so a page loaded mid-scan can restore the bar.

    The SSE stream only delivers events as they happen; a client that reloads
    has missed them and needs this snapshot to catch up.
    """
    with scan_state_lock:
        return jsonify(dict(scan_state))
