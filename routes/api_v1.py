# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
The public API, version 1.

This is the surface other services are meant to use, and the only one whose
shape is kept stable: the endpoints the web interface talks to are internal and
may change with it. Every request needs the API token (see core/api_access.py);
answers always carry ``success``, and a failure additionally carries ``error``
and a machine-readable ``code``.
"""
import queue

from flask import Blueprint, Response, jsonify, request

from core import library_ops
from core.api_access import apply_cors, authorization_error, error_response, preflight_response
from core.events import event_hub
from core.scan_state import scan_state, scan_state_lock

API_VERSION = 'v1'

bp = Blueprint('api_v1', __name__, url_prefix='/api/v1')


@bp.before_request
def _check_access():
    """Let a browser's preflight through, then require the token."""
    if request.method == 'OPTIONS':
        return preflight_response()
    return authorization_error()


@bp.after_request
def _add_cors(response):
    return apply_cors(response)


def _json_body():
    """The request's JSON body, or an empty dict when there is none."""
    return request.get_json(silent=True) or {}


def _required_path(body):
    """
    Read ``file_path`` from a request body.

    Returns ``(path, None)`` or ``(None, error_response)``.
    """
    file_path = body.get('file_path')
    if not isinstance(file_path, str) or not file_path.strip():
        return None, error_response(
            'missing_file_path', 'A "file_path" is required.', 400)
    return file_path, None


@bp.route('', methods=['GET', 'OPTIONS'])
@bp.route('/', methods=['GET', 'OPTIONS'])
def index():
    """What this API offers - handy to check a token and explore from a shell."""
    return jsonify({
        'success': True,
        'version': API_VERSION,
        'endpoints': {
            'GET /api/v1/library': 'Every scanned entry',
            'GET /api/v1/library/stats': 'Counts per HDR format, resolution and audio codec',
            'GET /api/v1/files': 'Video files in the media directory with their scan state',
            'GET /api/v1/scan/status': 'Progress of the scan that is running',
            'GET /api/v1/events': 'Server-Sent Events: scan progress and deletions',
            'POST /api/v1/scan': 'Scan everything that is not in the library yet',
            'POST /api/v1/scan/files': 'Scan the given {"file_paths": [...]}',
            'POST /api/v1/entries/scan': 'Scan one {"file_path": "..."} and wait for it',
            'POST /api/v1/entries/rescan': 'Re-read one {"file_path": "..."} from scratch',
            'POST /api/v1/entries/delete': 'Remove one {"file_path": "..."} from the library',
            'POST /api/v1/database/clear': 'Empty the library',
        }
    })


# --------------------------------------------------------------------- library

@bp.route('/library', methods=['GET', 'OPTIONS'])
def library():
    """Every scanned entry."""
    entries = library_ops.list_entries()
    return jsonify({'success': True, 'count': len(entries), 'files': entries})


@bp.route('/library/stats', methods=['GET', 'OPTIONS'])
def library_stats():
    """The library in numbers, without shipping the library itself."""
    summary = library_ops.library_summary()
    summary['success'] = True
    return jsonify(summary)


@bp.route('/files', methods=['GET', 'OPTIONS'])
def media_files():
    """Video files in the media directory, with whether they were scanned."""
    try:
        files = library_ops.list_media_files()
    except OSError as e:
        return error_response('media_unreadable', str(e), 500)
    return jsonify({'success': True, 'count': len(files), 'files': files})


# ------------------------------------------------------------------- scanning

@bp.route('/scan', methods=['POST', 'OPTIONS'])
def start_scan():
    """Scan everything that is not in the library yet, in the background."""
    library_ops.start_full_scan()
    return jsonify({'success': True, 'message': 'Scan started'}), 202


@bp.route('/scan/files', methods=['POST', 'OPTIONS'])
def scan_files():
    """Scan the given files in the background."""
    file_paths = _json_body().get('file_paths')
    if not isinstance(file_paths, list) or not file_paths:
        return error_response(
            'missing_file_paths', 'A non-empty "file_paths" list is required.', 400)

    queued = library_ops.start_scan_of(file_paths)
    return jsonify({
        'success': True,
        'message': 'Scan started',
        'queued': queued,
        'skipped': len(file_paths) - queued
    }), 202


@bp.route('/scan/status', methods=['GET', 'OPTIONS'])
def scan_status():
    """Progress of the scan that is currently running."""
    with scan_state_lock:
        state = dict(scan_state)
    return jsonify({'success': True, 'scan': state})


# -------------------------------------------------------------------- entries

@bp.route('/entries/scan', methods=['POST', 'OPTIONS'])
def scan_entry():
    """Scan a single file and wait for the result."""
    file_path, failure = _required_path(_json_body())
    if failure:
        return failure

    try:
        result = library_ops.scan_file(file_path)
    except FileNotFoundError:
        return error_response('file_not_found', 'No such file.', 404)
    except Exception as e:
        return error_response('scan_failed', str(e), 500)

    if not result or not result.get('success'):
        message = (result or {}).get('message') or 'The file could not be scanned.'
        return error_response('scan_failed', message, 409)

    return jsonify({'success': True, 'entry': result.get('file_info')})


@bp.route('/entries/rescan', methods=['POST', 'OPTIONS'])
def rescan_entry():
    """Re-read one entry from scratch, including every online lookup."""
    file_path, failure = _required_path(_json_body())
    if failure:
        return failure

    try:
        entry = library_ops.rescan_entry(file_path)
    except FileNotFoundError:
        return error_response('file_not_found', 'No such file.', 404)
    except Exception as e:
        return error_response('rescan_failed', str(e), 500)

    if entry is None:
        return error_response(
            'rescan_failed', 'The entry could not be re-scanned.', 409)

    return jsonify({'success': True, 'entry': entry})


@bp.route('/entries/delete', methods=['POST', 'OPTIONS'])
def delete_entry():
    """Remove one entry (and its cached poster) from the library."""
    file_path, failure = _required_path(_json_body())
    if failure:
        return failure

    try:
        removed = library_ops.delete_entry(file_path)
    except Exception as e:
        return error_response('delete_failed', str(e), 500)

    if not removed:
        return error_response(
            'entry_not_found', 'The library holds no entry for that path.', 404)

    return jsonify({'success': True, 'total': library_ops.entry_count()})


@bp.route('/database/clear', methods=['POST', 'OPTIONS'])
def clear_database():
    """Empty the library and delete every cached poster."""
    try:
        library_ops.clear_library()
    except Exception as e:
        return error_response('clear_failed', str(e), 500)
    return jsonify({'success': True, 'total': 0})


# --------------------------------------------------------------------- events

@bp.route('/events', methods=['GET', 'OPTIONS'])
def events():
    """
    Scan progress and deletions as they happen.

    The browser's EventSource cannot send headers, so this is the endpoint the
    ``?token=`` parameter exists for.
    """
    def event_stream():
        subscriber = event_hub.subscribe()
        try:
            while True:
                try:
                    event, data = subscriber.get(timeout=30)
                except queue.Empty:
                    yield ": keep-alive\n\n"
                    continue
                yield f"event: {event}\ndata: {data}\n\n"
        finally:
            event_hub.unsubscribe(subscriber)

    response = Response(event_stream(), mimetype='text/event-stream')
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['X-Accel-Buffering'] = 'no'
    return response
