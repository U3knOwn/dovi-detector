# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
The public API, version 1.

This is the surface other services are meant to use, and the only one whose
shape is kept stable: the endpoints the web interface talks to are internal and
may change with it. Every request needs the API token (see core/api_access.py);
answers always carry ``success``, and a failure additionally carries ``error``
and a machine-readable ``code`` - including the failures Flask itself produces,
see the error handler at the bottom of this module.
"""
import os

from flask import Blueprint, jsonify, request, send_file
from werkzeug.exceptions import HTTPException

from core import library_ops
from core.api_access import apply_cors, authorization_error, error_response, preflight_response
from core.posters import cached_poster_path
from core.scan_state import request_cancel, scan_is_running, scan_state, scan_state_lock
from core.sse import sse_response

API_VERSION = 'v1'
API_PREFIX = f'/api/{API_VERSION}'

bp = Blueprint('api_v1', __name__, url_prefix=API_PREFIX)


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


def _int_arg(name, default=None, minimum=0):
    """
    Read a whole number from the query string.

    Returns ``(value, None)`` or ``(None, error_response)``; an absent or empty
    parameter yields the default rather than an error.
    """
    raw = request.args.get(name)
    if raw is None or not raw.strip():
        return default, None

    try:
        value = int(raw)
    except ValueError:
        return None, error_response(
            'invalid_parameter', f'"{name}" must be a whole number.', 400)

    if value < minimum:
        return None, error_response(
            'invalid_parameter', f'"{name}" must not be below {minimum}.', 400)

    return value, None


def _choice_arg(name, allowed, default):
    """
    Read a query parameter that has to be one of ``allowed``.

    Returns ``(value, None)`` or ``(None, error_response)``.
    """
    value = request.args.get(name) or default
    if value not in allowed:
        options = ', '.join(sorted(allowed))
        return None, error_response(
            'invalid_parameter', f'"{name}" must be one of: {options}.', 400)
    return value, None


@bp.route('', methods=['GET', 'OPTIONS'])
@bp.route('/', methods=['GET', 'OPTIONS'])
def index():
    """What this API offers - handy to check a token and explore from a shell."""
    return jsonify({
        'success': True,
        'version': API_VERSION,
        'endpoints': {
            'GET /api/v1/library': 'Every scanned entry; filter, sort and page with query parameters',
            'GET /api/v1/library/stats': 'Counts per HDR format, resolution and audio codec',
            'GET /api/v1/entries?file_path=...': 'One entry by its path',
            'GET /api/v1/files': 'Video files in the media directory with their scan state',
            'GET /api/v1/posters/<filename>': 'A cached poster image, as named by an entry\'s poster_url',
            'GET /api/v1/scan/status': 'Progress of the scan that is running',
            'GET /api/v1/events': 'Server-Sent Events: scan progress and deletions',
            'POST /api/v1/scan': 'Scan everything that is not in the library yet',
            'POST /api/v1/scan/files': 'Scan the given {"file_paths": [...]}',
            'POST /api/v1/scan/cancel': 'Stop the scan that is running',
            'POST /api/v1/entries/scan': 'Scan one {"file_path": "..."} and wait for it',
            'POST /api/v1/entries/rescan': 'Re-read one {"file_path": "..."} from scratch',
            'POST /api/v1/entries/delete': 'Remove one {"file_path": "..."} from the library',
            'POST /api/v1/database/clear': 'Empty the library',
        },
        'library_query': {
            'filter': list(library_ops.LIBRARY_FILTERS),
            'search': list(library_ops.SEARCH_FIELDS),
            'sort': sorted(library_ops.SORT_KEYS),
            'order': ['asc', 'desc'],
            'page': ['limit', 'offset'],
        }
    })


# --------------------------------------------------------------------- library

@bp.route('/library', methods=['GET', 'OPTIONS'])
def library():
    """
    Every scanned entry, or the part of it the caller asked for.

    Without parameters this is the whole library, as it always was. With them a
    caller can narrow it down server-side instead of downloading thousands of
    entries to find the handful it wants: ``hdr_format``, ``el_type``,
    ``resolution`` and ``audio_codec`` filter, ``search`` matches the file name
    or the title, ``sort``/``order`` order the result and ``limit``/``offset``
    cut a window out of it. ``total`` always counts the matches before that
    window, so a pager knows how far it has to go.
    """
    limit, failure = _int_arg('limit', minimum=1)
    if failure:
        return failure

    offset, failure = _int_arg('offset', default=0, minimum=0)
    if failure:
        return failure

    sort, failure = _choice_arg('sort', library_ops.SORT_KEYS, 'filename')
    if failure:
        return failure

    order, failure = _choice_arg('order', ('asc', 'desc'), 'asc')
    if failure:
        return failure

    filters = {
        field: request.args[field]
        for field in library_ops.LIBRARY_FILTERS
        if (request.args.get(field) or '').strip()
    }

    entries, total = library_ops.query_entries(
        filters=filters,
        search=request.args.get('search'),
        sort=sort,
        order=order,
        limit=limit,
        offset=offset)

    return jsonify({
        'success': True,
        'count': len(entries),
        'total': total,
        'offset': offset,
        'limit': limit,
        'files': entries
    })


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


# --------------------------------------------------------------------- posters

@bp.route('/posters/<filename>', methods=['GET', 'OPTIONS'])
def poster(filename):
    """
    A cached poster image.

    An entry's ``poster_url`` is ``/poster/<name>.jpg`` once the image has been
    cached; this serves the same file inside the API, so a consumer never has to
    leave /api/v1 - or guess whether an unversioned path will stay where it is.
    An entry whose image could not be cached carries the remote URL instead, and
    that one is fetched from its own host.
    """
    poster_path = cached_poster_path(filename)
    if poster_path is None:
        return error_response(
            'invalid_poster_name',
            'Not a poster file name - use the name from an entry\'s poster_url.',
            400)

    if not os.path.exists(poster_path):
        return error_response('poster_not_found', 'No such poster.', 404)

    return send_file(poster_path, mimetype='image/jpeg')


# ------------------------------------------------------------------- scanning

@bp.route('/scan', methods=['POST', 'OPTIONS'])
def start_scan():
    """Scan everything that is not in the library yet, in the background."""
    if not library_ops.start_full_scan():
        return _scan_running_error()
    return jsonify({'success': True, 'message': 'Scan started'}), 202


@bp.route('/scan/files', methods=['POST', 'OPTIONS'])
def scan_files():
    """Scan the given files in the background."""
    file_paths = _json_body().get('file_paths')
    if not isinstance(file_paths, list) or not file_paths:
        return error_response(
            'missing_file_paths', 'A non-empty "file_paths" list is required.', 400)

    queued = library_ops.start_scan_of(file_paths)
    if queued is None:
        return _scan_running_error()

    return jsonify({
        'success': True,
        'message': 'Scan started',
        'queued': queued,
        'skipped': len(file_paths) - queued
    }), 202


@bp.route('/scan/cancel', methods=['POST', 'OPTIONS'])
def cancel_scan():
    """
    Stop the running scan.

    The files being probed right now are seen through, so nothing is left half
    written; everything after them is dropped. The scan then reports itself as
    ``cancelled`` instead of ``done`` - what it managed to scan stays in the
    library.
    """
    if not request_cancel():
        return error_response(
            'no_scan_running', 'No scan is running.', 409)
    return jsonify({'success': True, 'message': 'Cancelling scan'}), 202


@bp.route('/scan/status', methods=['GET', 'OPTIONS'])
def scan_status():
    """
    Progress of the scan that is currently running.

    ``running`` tells whether the scanner is claimed at all, which is not the
    same as ``scan.status``: a scan that is still clearing out vanished files has
    not reported any progress yet.
    """
    with scan_state_lock:
        state = dict(scan_state)
    return jsonify({'success': True, 'running': scan_is_running(), 'scan': state})


def _scan_running_error():
    """The answer to a second scan request while one is still going."""
    return error_response(
        'scan_running',
        'A scan is already running. Follow it at /api/v1/scan/status or stop it '
        'at /api/v1/scan/cancel.',
        409)


# -------------------------------------------------------------------- entries

@bp.route('/entries', methods=['GET', 'OPTIONS'])
def entry_by_path():
    """One entry by its path, so a caller after a single title needs no more."""
    file_path = request.args.get('file_path')
    if not file_path or not file_path.strip():
        return error_response(
            'missing_file_path', 'A "file_path" is required.', 400)

    found = library_ops.get_entry(file_path)
    if found is None:
        return error_response(
            'entry_not_found', 'The library holds no entry for that path.', 404)

    return jsonify({'success': True, 'entry': found})


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

    Opens with the current scan state as a ``scan_state`` event, then delivers
    ``scan_progress`` and ``file_deleted`` as they are published. Every event
    carries an id: a client that reconnects with ``Last-Event-ID`` (the browser's
    EventSource does this itself, others may pass ``?last_event_id=``) is handed
    what it missed while it was away.

    The browser's EventSource cannot send headers, so this is the endpoint the
    ``?token=`` parameter exists for.
    """
    return sse_response()


# ---------------------------------------------------------------------- errors

# What Flask itself raises: a path that does not exist, a method that is not
# allowed for one, an exception a view did not catch. Answered in the API's own
# shape rather than in HTML - a client that parses JSON should not have to
# special-case a typo in a URL.
_ERROR_CODES = {
    400: 'bad_request',
    404: 'not_found',
    405: 'method_not_allowed',
    413: 'payload_too_large',
    415: 'unsupported_media_type',
    500: 'internal_error',
}

_ERROR_MESSAGES = {
    404: f'No such endpoint. GET {API_PREFIX} lists them.',
    405: f'That method is not allowed here. GET {API_PREFIX} lists the endpoints.',
    # Deliberately says nothing about the cause: the exception is logged, not
    # handed to whoever sent the request.
    500: 'The request could not be completed.',
}


@bp.app_errorhandler(HTTPException)
def api_error(error):
    """
    Answer an error under /api/v1 as JSON, and leave every other path alone.

    Registered application-wide because the errors this exists for happen before
    any blueprint is reached: routing decides that no endpoint matches, so a 404
    or 405 never belongs to one. An unhandled exception arrives here too, as
    Flask turns it into an InternalServerError first.
    """
    if not request.path.startswith(API_PREFIX):
        return error

    status = error.code or 500
    response = error_response(
        _ERROR_CODES.get(status, 'http_error'),
        _ERROR_MESSAGES.get(status) or error.description,
        status)

    # A 405 has to name the methods that would have worked, and the CORS headers
    # have to be set here as well: the blueprint's own hooks never ran.
    allow = error.get_response().headers.get('Allow')
    if allow:
        response.headers['Allow'] = allow

    return apply_cors(response)
