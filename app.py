#!/usr/bin/env python3
# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Universal Video Scanner - Main Application
Flask web application for scanning and managing video files
"""
import os
import re
import json
import time
import threading
import queue
from flask import Flask, render_template, jsonify, request, send_file, Response
from flask.helpers import send_from_directory

# Import configuration
import config

# Import utility functions
from utils.file_utils import copy_static_and_templates_to_data_dir
from utils.i18n import translate, get_request_language

# Import service modules
from services import database
from services.tmdb_service import get_tmdb_poster, get_tmdb_poster_by_id, get_tmdb_credits, get_imdb_id
from services.imdb_service import get_omdb_ratings, get_top250_rank, load_top250, backfill_imdb_data
from services.fanart_service import get_fanart_poster
from services.poster_service import delete_cached_poster, get_cached_backdrop_path, migrate_poster_urls_to_cache
from services.video_scanner import (
    scan_video_file, scan_directory, background_scan_new_files, bulk_scan_files,
    fetch_online_metadata, refresh_incomplete_entries
)

# Import watcher
from watchers.media_watcher import start_file_observer

# Initialize Flask app
app = Flask(__name__,
            template_folder=config.TEMPLATES_DIR,
            static_folder=config.STATIC_DIR)

# Event queues for Server-Sent Events
deletion_event_queue = queue.Queue()
scan_progress_queue = queue.Queue()

# Last published scan progress. The queue only carries events to whoever is
# listening at that moment, so a page reload mid-scan would otherwise show no
# progress bar at all. This is the authoritative state /scan_status serves.
scan_state = {'status': 'idle', 'current': 0, 'total': 0, 'percent': 0, 'filename': ''}
scan_state_lock = threading.Lock()


def publish_scan_progress(payload):
    """Record the progress state and push it to connected clients."""
    with scan_state_lock:
        if payload.get('status') == 'scanning':
            scan_state.update(payload)
        else:
            # A finished or failed run leaves no bar behind on the next reload
            scan_state.update(payload)
            scan_state['filename'] = ''
    try:
        scan_progress_queue.put(json.dumps(payload))
    except Exception as e:
        print(f"Error queuing scan progress: {e}")


def report_scan_progress(current, total, file_path, result):
    """Progress callback shared by the manual and the startup scan."""
    publish_scan_progress({
        'current': current,
        'total': total,
        'percent': int((current / total) * 100) if total else 0,
        'status': 'scanning',
        'filename': os.path.basename(file_path)
    })


# Helper function wrappers to pass dependencies to scan_video_file
def _scan_video_file_wrapper(file_path, defer_save=False):
    """Wrapper function for scan_video_file with all dependencies"""
    return scan_video_file(
        file_path,
        database.scanned_paths,
        database.scanned_files,
        database.scan_lock,
        lambda: database.save_database(config.DB_FILE),
        lambda filename: get_fanart_poster(filename, config.FANART_API_KEY, config.CONTENT_LANGUAGE),
        lambda filename: get_tmdb_poster(filename, config.TMDB_API_KEY, config.CONTENT_LANGUAGE),
        lambda tmdb_id, media_type: get_tmdb_poster_by_id(tmdb_id, media_type, config.TMDB_API_KEY, config.CONTENT_LANGUAGE),
        lambda tmdb_id, media_type: get_tmdb_credits(tmdb_id, media_type, config.TMDB_API_KEY),
        lambda tmdb_id, poster_url: get_cached_backdrop_path(tmdb_id, poster_url, config.POSTER_CACHE_DIR),
        lambda tmdb_id, media_type: get_imdb_id(tmdb_id, media_type, config.TMDB_API_KEY),
        lambda imdb_id: get_omdb_ratings(imdb_id, config.OMDB_API_KEY),
        lambda imdb_id: get_top250_rank(imdb_id, config.IMDB_TOP250_CACHE_FILE, config.IMDB_TOP250_TTL),
        defer_save=defer_save
    )


def _fetch_online_metadata_wrapper(filename):
    """Wrapper for fetch_online_metadata with all dependencies"""
    return fetch_online_metadata(
        filename,
        lambda fn: get_fanart_poster(fn, config.FANART_API_KEY, config.CONTENT_LANGUAGE),
        lambda fn: get_tmdb_poster(fn, config.TMDB_API_KEY, config.CONTENT_LANGUAGE),
        lambda tmdb_id, media_type: get_tmdb_poster_by_id(tmdb_id, media_type, config.TMDB_API_KEY, config.CONTENT_LANGUAGE),
        lambda tmdb_id, media_type: get_tmdb_credits(tmdb_id, media_type, config.TMDB_API_KEY),
        lambda tmdb_id, poster_url: get_cached_backdrop_path(tmdb_id, poster_url, config.POSTER_CACHE_DIR),
        lambda tmdb_id, media_type: get_imdb_id(tmdb_id, media_type, config.TMDB_API_KEY),
        lambda imdb_id: get_omdb_ratings(imdb_id, config.OMDB_API_KEY),
        lambda imdb_id: get_top250_rank(imdb_id, config.IMDB_TOP250_CACHE_FILE, config.IMDB_TOP250_TTL)
    )


def _metadata_retry_loop():
    """
    Periodically retry entries whose online lookups came back incomplete.

    This is what makes an entry heal itself once an API is reachable again or
    a key is added - without it, a failed lookup would stay empty until the
    file is rescanned by hand.
    """
    interval = config.METADATA_RETRY_INTERVAL * 60
    while True:
        time.sleep(interval)
        try:
            refresh_incomplete_entries(
                database.scanned_files,
                database.scan_lock,
                lambda: database.save_database(config.DB_FILE),
                _fetch_online_metadata_wrapper
            )
        except Exception as e:
            print(f"Error during metadata retry: {e}")


def _refresh_imdb_data():
    """
    Load the IMDb Top 250 chart and backfill IMDb data into the database.

    Runs on a background thread at startup: entries scanned before the IMDb
    integration existed get their IMDb id and rating, and every entry's Top 250
    rank is refreshed against the current chart.
    """
    top250_map = load_top250(config.IMDB_TOP250_CACHE_FILE, config.IMDB_TOP250_TTL)
    backfill_imdb_data(
        database.scanned_files,
        database.scan_lock,
        lambda: database.save_database(config.DB_FILE),
        lambda tmdb_id, media_type: get_imdb_id(tmdb_id, media_type, config.TMDB_API_KEY),
        lambda imdb_id: get_omdb_ratings(imdb_id, config.OMDB_API_KEY),
        top250_map
    )


def _delete_cached_poster_wrapper(file_info):
    """Wrapper function for delete_cached_poster with dependencies"""
    return delete_cached_poster(file_info, config.POSTER_CACHE_DIR)


# Flask Routes

@app.route('/')
def index():
    """Main page showing scanned files"""
    files_list = list(database.scanned_files.values())
    
    # Add modification time for sorting
    for file_info in files_list:
        file_path = file_info.get('path', '')
        try:
            file_info['mtime'] = os.path.getmtime(file_path)
        except (OSError, TypeError):
            file_info['mtime'] = 0
    
    # Sort by filename
    files_list.sort(key=lambda x: x['filename'])

    return render_template(
        'index.html',
        files=files_list,
        file_count=len(files_list),
        auto_refresh_interval=config.AUTO_REFRESH_INTERVAL)


@app.route('/scan', methods=['POST'])
def manual_scan():
    """Endpoint for manual scan trigger - runs scan in background with progress updates"""
    def _run_scan():
        try:
            # Clean up database for non-existent files
            removed_count = database.cleanup_database(config.DB_FILE, _delete_cached_poster_wrapper)

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
                _scan_video_file_wrapper,
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


@app.route('/get_files', methods=['GET'])
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


@app.route('/scan_file', methods=['POST'])
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
        result = _scan_video_file_wrapper(file_path)

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


@app.route('/scan_files', methods=['POST'])
def scan_multiple_files():
    """Scan a user-selected set of files in the background with progress updates.

    Mirrors the progress protocol of /scan (via scan_progress_queue) so the
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
                _scan_video_file_wrapper,
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


@app.route('/poster/<filename>')
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


@app.route('/scan_status', methods=['GET'])
def scan_status():
    """
    Current scan progress, so a page loaded mid-scan can restore the bar.

    The SSE stream only delivers events as they happen; a client that reloads
    has missed them and needs this snapshot to catch up.
    """
    with scan_state_lock:
        return jsonify(dict(scan_state))


@app.route('/events')
def events():
    """Server-Sent Events endpoint for real-time updates"""
    def event_stream():
        # Send a keep-alive comment every 30 seconds
        last_keepalive = time.time()

        while True:
            try:
                # Check for scan progress events first (non-blocking)
                try:
                    progress_data = scan_progress_queue.get_nowait()
                    yield f"event: scan_progress\ndata: {progress_data}\n\n"
                    continue
                except queue.Empty:
                    pass

                # Check for deletion events (non-blocking with timeout)
                try:
                    event_data = deletion_event_queue.get(timeout=0.5)
                    yield f"event: file_deleted\ndata: {event_data}\n\n"
                except queue.Empty:
                    # Send keep-alive every 30 seconds
                    current_time = time.time()
                    if current_time - last_keepalive > 30:
                        yield ": keep-alive\n\n"
                        last_keepalive = current_time
            except GeneratorExit:
                break

    return Response(event_stream(), mimetype='text/event-stream')


@app.route('/clear_database', methods=['POST'])
def clear_database():
    """Clear the entire scanned_files database (and cached posters)."""
    try:
        # Use the same lock used by scanner to avoid races
        with database.scan_lock:
            # Delete cached posters for all files
            try:
                for file_info in list(database.scanned_files.values()):
                    try:
                        _delete_cached_poster_wrapper(file_info)
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


@app.route('/delete_entry', methods=['POST'])
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
                _delete_cached_poster_wrapper(file_info)
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


@app.route('/rescan_entry', methods=['POST'])
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
            _delete_cached_poster_wrapper(old_info)

        result = _scan_video_file_wrapper(file_path)

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


def main():
    """Main application entry point"""
    print("=" * 50)
    print("Starting Universal Video Scanner")
    print("=" * 50)

    # Ensure all required directories exist
    config.ensure_directories()

    # Copy static and templates directories to data directory
    # This allows users to modify these files from the host system
    copy_static_and_templates_to_data_dir(
        config.STATIC_DIR,
        config.TEMPLATES_DIR,
        config.DATA_DIR
    )

    # Update Flask app to use copied directories
    app.template_folder = config.get_templates_dir()
    app.static_folder = config.get_static_dir()
    
    # Flask caches the static folder path in its view function at initialization.
    # We need to update the static view function to use the new folder.
    # This ensures static files (CSS, JS, etc.) are served from the data directory.
    if app.static_folder and 'static' in app.view_functions:
        def updated_static(filename):
            """
            Updated static file handler that uses the new static folder.
            Flask's send_from_directory already handles path traversal security.
            """
            return send_from_directory(app.static_folder, filename)
        
        app.view_functions['static'] = updated_static
    
    print(f"Flask using templates from: {app.template_folder}")
    print(f"Flask using static files from: {app.static_folder}")

    # Load existing database
    database.load_database(config.DB_FILE)

    # Show configured content language
    print(f"Content language: {config.CONTENT_LANGUAGE.upper()}")

    # Migrate existing poster URLs to cached versions
    if config.REQUESTS_AVAILABLE:
        print(f"Image source: {config.IMAGE_SOURCE.upper()}")
        if config.IMAGE_SOURCE == 'fanart':
            if config.FANART_API_KEY:
                print("✓ Fanart.tv API key configured")
            else:
                print("⚠ Warning: Fanart.tv selected but FANART_API_KEY not configured - no posters will be fetched")
        elif config.IMAGE_SOURCE == 'tmdb':
            if config.TMDB_API_KEY:
                print("✓ TMDB API key configured")
            else:
                print("⚠ Warning: TMDB selected but TMDB_API_KEY not configured - no posters will be fetched")
        else:
            print(f"⚠ Warning: Unknown IMAGE_SOURCE '{config.IMAGE_SOURCE}' - defaulting to TMDB")
            if config.TMDB_API_KEY:
                print("✓ TMDB API key configured")
            else:
                print("⚠ Warning: TMDB_API_KEY not configured - no posters will be fetched")
        if config.OMDB_API_KEY:
            print("✓ OMDb API key configured - IMDb ratings enabled")
        else:
            print("⚠ Warning: OMDB_API_KEY not configured - falling back to TMDB ratings")

        # Load the Top 250 list once at startup (so the first scanned files do
        # not each wait on it) and bring existing database entries up to date -
        # both in the background, as they only touch the network.
        threading.Thread(target=_refresh_imdb_data, daemon=True).start()

        print("Migrating poster URLs to cache...")
        migrate_poster_urls_to_cache(
            database.scanned_files,
            database.scan_lock,
            lambda: database.save_database(config.DB_FILE),
            config.POSTER_CACHE_DIR
        )

    # Clean up database for non-existent files
    removed_count = database.cleanup_database(config.DB_FILE, _delete_cached_poster_wrapper)
    if removed_count > 0:
        print(f"Cleaned up {removed_count} entries for non-existent files")

    # Start file observer in background
    observer = start_file_observer(
        _scan_video_file_wrapper,
        database.scanned_files,
        database.scanned_paths,
        database.scan_lock,
        lambda: database.save_database(config.DB_FILE),
        _delete_cached_poster_wrapper,
        deletion_event_queue
    )

    # Retry entries whose metadata lookups failed, so they heal themselves
    # once the API is reachable again
    if config.METADATA_RETRY_INTERVAL > 0:
        threading.Thread(target=_metadata_retry_loop, daemon=True).start()
        print(f"Metadata retry every {config.METADATA_RETRY_INTERVAL} min for incomplete entries")
    else:
        print("Metadata retry disabled (METADATA_RETRY_INTERVAL=0)")

    # Start initial scan automatically in background, reporting progress so the
    # UI shows the same bar as a manual scan - and can restore it after a reload
    def _run_initial_scan():
        seen = {'total': 0}

        def _progress(current, total, file_path, result):
            seen['total'] = total
            report_scan_progress(current, total, file_path, result)

        try:
            scanned_new = background_scan_new_files(
                database.scanned_paths,
                _scan_video_file_wrapper,
                lambda: database.save_database(config.DB_FILE),
                config.SCAN_WORKERS,
                _progress)
        except Exception as e:
            print(f"Error during initial scan: {e}")
            publish_scan_progress({'status': 'error', 'error': str(e)})
            return

        # Only close out the bar when there was something to show; a startup
        # with nothing new should not push a "scan finished" message at clients
        if seen['total']:
            publish_scan_progress({
                'current': seen['total'], 'total': seen['total'], 'percent': 100,
                'status': 'done', 'new_files': scanned_new or 0,
                'removed_files': 0, 'total_files': len(database.scanned_files)
            })

    threading.Thread(target=_run_initial_scan, daemon=True).start()
    print("Initial scan started...")

    # Start Flask app
    try:
        app.run(host='0.0.0.0', port=2367, debug=False, threaded=True)
    except KeyboardInterrupt:
        print("Shutting down...")
        observer.stop()
        observer.join()


if __name__ == '__main__':
    main()
