# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Changing single entries: deleting, re-scanning, and emptying the database.
"""
import json
import os

from flask import Blueprint, jsonify, request

import config
from core.events import deletion_event_queue
from core.scanner import delete_cached_poster_for, scan_video_file_with_deps
from services import database
from utils.i18n import get_request_language, translate

bp = Blueprint('entries', __name__)


@bp.route('/clear_database', methods=['POST'])
def clear_database():
    """Clear the entire scanned_files database (and cached posters)."""
    try:
        # Use the same lock used by scanner to avoid races
        with database.scan_lock:
            # Delete cached posters for all files
            try:
                for file_info in list(database.scanned_files.values()):
                    try:
                        delete_cached_poster_for(file_info)
                    except Exception as e:
                        print(f"Error deleting poster for {file_info.get('filename')}: {e}")
            except Exception as e:
                print(f"Error while deleting cached posters: {e}")

            # Clear in-memory DB
            database.scanned_files.clear()
            database.scanned_paths.clear()

            # Persist the empty DB
            database.save_database(config.DB_FILE)

            # Notify SSE clients that DB was cleared
            try:
                if deletion_event_queue is not None:
                    deletion_event_queue.put(json.dumps({'cleared': True}))
            except Exception as e:
                print(f"Error queuing clear event: {e}")

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

        with database.scan_lock:
            if file_path in database.scanned_files:
                file_info = database.scanned_files[file_path]
                delete_cached_poster_for(file_info)
                del database.scanned_files[file_path]
                database.scanned_paths.discard(file_path)
                database.save_database(config.DB_FILE)

                try:
                    deletion_event_queue.put(json.dumps({'file_path': file_path}))
                except Exception as e:
                    print(f"Error queuing deletion event: {e}")

                return jsonify({'success': True, 'total_files': len(database.scanned_files)})
            else:
                return jsonify({'success': False, 'error': translate('api_file_not_found', lang)}), 404
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

        if not os.path.exists(file_path):
            return jsonify({'success': False, 'error': translate('api_file_not_found', lang)}), 404

        # Drop the old record first - scan_video_file skips paths it already
        # knows, and the cached poster is replaced by the fresh one.
        with database.scan_lock:
            old_info = database.scanned_files.pop(file_path, None)
            database.scanned_paths.discard(file_path)
        if old_info:
            delete_cached_poster_for(old_info)

        result = scan_video_file_with_deps(file_path)

        if result and result.get('success'):
            return jsonify({
                'success': True,
                'message': translate('api_file_scanned_successfully', lang),
                'file_info': result.get('file_info')
            })

        # Scanning failed - put the previous record back so the entry does not
        # silently vanish from the library.
        if old_info:
            with database.scan_lock:
                database.scanned_files[file_path] = old_info
                database.scanned_paths.add(file_path)
                database.save_database(config.DB_FILE)
        return jsonify({'success': False, 'error': translate('rescan_entry_error', lang)}), 500
    except Exception as e:
        print(f"Error in rescan_entry: {e}")
        return jsonify({'success': False, 'error': translate('rescan_entry_error', lang)}), 500
