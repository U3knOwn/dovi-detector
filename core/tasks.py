# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
The work that runs in the background: healing incomplete entries, filling in
data a scan could not get, and the scan that starts with the application.
"""
import threading
import time

import config
from core.scan_state import publish_scan_progress, report_scan_progress
from core.scanner import fetch_online_metadata_with_deps, scan_video_file_with_deps
from services import database
from services.imdb_service import backfill_imdb_data, load_top250
from services.tmdb_service import backfill_tmdb_genres, get_imdb_id
from services.imdb_service import get_omdb_ratings
from services.tmdb_service import get_tmdb_genres
from services.video_scanner import background_scan_new_files, refresh_incomplete_entries


def metadata_retry_loop():
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
                fetch_online_metadata_with_deps,
                config.METADATA_RETRY_BATCH
            )
        except Exception as e:
            print(f"Error during metadata retry: {e}")


def refresh_imdb_data():
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


def refresh_tmdb_genres():
    """
    Backfill the genre list into entries scanned before genres were collected.

    Runs on a background thread at startup for the same reason as the IMDb
    backfill: an existing library should show the new field without every file
    having to be rescanned by hand.
    """
    backfill_tmdb_genres(
        database.scanned_files,
        database.scan_lock,
        lambda: database.save_database(config.DB_FILE),
        lambda tmdb_id, media_type: get_tmdb_genres(tmdb_id, media_type, config.TMDB_API_KEY, config.CONTENT_LANGUAGE)
    )


# Start initial scan automatically in background, reporting progress so the
# UI shows the same bar as a manual scan - and can restore it after a reload
def run_initial_scan():
    seen = {'total': 0}

    def _progress(current, total, file_path, result):
        seen['total'] = total
        report_scan_progress(current, total, file_path, result)

    try:
        scanned_new = background_scan_new_files(
            database.scanned_paths,
            scan_video_file_with_deps,
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


def start_background_tasks():
    """
    Start everything that keeps the library up to date on its own.

    All of it only touches the network or waits, so none of it belongs on the
    request path - and none of it may hold up the startup either.
    """
    if config.REQUESTS_AVAILABLE:
        # Load the Top 250 list once at startup (so the first scanned files do
        # not each wait on it) and bring existing database entries up to date -
        # both in the background, as they only touch the network.
        threading.Thread(target=refresh_imdb_data, daemon=True).start()

        # Same idea for the genres, which older entries do not carry yet
        if config.TMDB_API_KEY:
            threading.Thread(target=refresh_tmdb_genres, daemon=True).start()

    # Retry entries whose metadata lookups failed, so they heal themselves
    # once the API is reachable again
    if config.METADATA_RETRY_INTERVAL > 0:
        threading.Thread(target=metadata_retry_loop, daemon=True).start()
        print(f"Metadata retry every {config.METADATA_RETRY_INTERVAL} min for incomplete entries")
    else:
        print("Metadata retry disabled (METADATA_RETRY_INTERVAL=0)")

    threading.Thread(target=run_initial_scan, daemon=True).start()
    print("Initial scan started...")
