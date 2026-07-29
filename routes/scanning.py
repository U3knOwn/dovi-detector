# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Starting scans and following their progress.
"""
import os
import threading

from flask import Blueprint, jsonify, request

import config
from core.scan_state import (
    publish_scan_progress, report_scan_progress, scan_state, scan_state_lock
)
from core.scanner import delete_cached_poster_for, scan_video_file_with_deps
from services import database
from services.video_scanner import bulk_scan_files, scan_directory
from utils.i18n import get_request_language, translate

bp = Blueprint('scanning', __name__)


@bp.route('/scan', methods=['POST'])
def manual_scan():
    """Endpoint for manual scan trigger - runs scan in background with progress updates"""
    def _run_scan():
        try:
            # Clean up database for non-existent files
            removed_count = database.cleanup_database(config.DB_FILE, delete_cached_poster_for)

            # Scan for new files
            new_files = scan_directory(config.MEDIA_PATH, database.scanned_paths)
            total = len(new_files)

            if total == 0:
                publish_scan_progress({
                    'current': 0, 'total': 0, 'percent': 0,
                    'status': 'done', 'new_files': 0,
                    'removed_files': removed_count,
                    'total_files': len(database.scanned_files)
                })
                return

            # Scan the new files (batched DB writes, optional parallelism),
            # streaming progress to the UI as each file finishes.
            scanned_new_count = bulk_scan_files(
                new_files,
                scan_video_file_with_deps,
                lambda: database.save_database(config.DB_FILE),
                config.SCAN_WORKERS,
                report_scan_progress)

            final_count = len(database.scanned_files)
            publish_scan_progress({
                'current': total, 'total': total, 'percent': 100,
                'status': 'done', 'new_files': scanned_new_count,
                'removed_files': removed_count,
                'total_files': final_count
            })
        except Exception as e:
            publish_scan_progress({
                'status': 'error', 'error': str(e)
            })

    thread = threading.Thread(target=_run_scan, daemon=True)
    thread.start()

    return jsonify({'success': True, 'message': 'Scan started'})


@bp.route('/get_files', methods=['GET'])
def get_files():
    """Get list of available video files for dropdown selection"""
    try:
        all_files = []
        for root, dirs, files in os.walk(config.MEDIA_PATH):
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in config.SUPPORTED_FORMATS:
                    file_path = os.path.join(root, file)
                    is_scanned = file_path in database.scanned_paths
                    all_files.append({
                        'path': file_path,
                        'name': file,  # Only filename, not path
                        'scanned': is_scanned
                    })

        # Sort unscanned files first so users immediately see what still
        # needs scanning, then by name (A-Z, case-insensitive) within each group.
        all_files.sort(key=lambda x: (x['scanned'], x['name'].lower()))

        return jsonify({
            'success': True,
            'files': all_files
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

        if not os.path.exists(file_path):
            return jsonify({
                'success': False,
                'error': translate('api_file_not_found', lang)
            }), 404

        # Scan the file
        result = scan_video_file_with_deps(file_path)

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

    # Keep only paths that still exist on disk, preserving the given order.
    valid_paths = [p for p in file_paths if isinstance(p, str) and os.path.exists(p)]

    def _run_scan():
        try:
            total = len(valid_paths)

            if total == 0:
                publish_scan_progress({
                    'current': 0, 'total': 0, 'percent': 0,
                    'status': 'done', 'new_files': 0,
                    'removed_files': 0,
                    'total_files': len(database.scanned_files)
                })
                return

            scanned_new_count = bulk_scan_files(
                valid_paths,
                scan_video_file_with_deps,
                lambda: database.save_database(config.DB_FILE),
                config.SCAN_WORKERS,
                report_scan_progress)

            publish_scan_progress({
                'current': total, 'total': total, 'percent': 100,
                'status': 'done', 'new_files': scanned_new_count,
                'removed_files': 0,
                'total_files': len(database.scanned_files)
            })
        except Exception as e:
            publish_scan_progress({
                'status': 'error', 'error': str(e)
            })

    thread = threading.Thread(target=_run_scan, daemon=True)
    thread.start()

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
