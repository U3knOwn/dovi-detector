# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
The work that runs in the background: healing incomplete entries, filling in
data a scan could not get, and the scan that starts with the application.
"""
import threading
import time

import config
from core.scan_state import (begin_scan, cancel_requested, end_scan,
                             publish_scan_progress, report_scan_progress)
from core.scanner import (cache_portrait_for, fetch_online_metadata_with_deps,
                          fetch_portrait_for, scan_video_file_with_deps)
from services import database
from services.imdb_service import backfill_imdb_data, load_top250
from services.poster_service import backfill_portraits
from services.ratings_service import (RATINGS_QUERIED_KEY, get_ratings,
                                      verify_ratings_key)
from services.tmdb_service import (backfill_tmdb_details, get_imdb_id,
                                   get_tmdb_details)
from services.video_scanner import (backfill_video_codec,
                                    background_scan_new_files,
                                    refresh_incomplete_entries)


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
    integration existed get their IMDb id and ratings, entries that predate the
    Rotten Tomatoes audience score and the Trakt rating are looked up once more
    for those, and every entry's Top 250 rank is refreshed against the current
    chart.
    """
    top250_map = load_top250(config.IMDB_TOP250_CACHE_FILE, config.IMDB_TOP250_TTL)

    # Check the key before walking the library with it: a key MDBList refuses
    # otherwise looks exactly like a library whose titles have no ratings, and
    # the answer also reports how much of the daily budget is left for the
    # backfill.
    if config.MDBLIST_API_KEY:
        verify_ratings_key(config.MDBLIST_API_KEY)

    backfill_imdb_data(
        database.scanned_files,
        database.scan_lock,
        lambda: database.save_database(config.DB_FILE),
        lambda tmdb_id, media_type: get_imdb_id(tmdb_id, media_type, config.TMDB_API_KEY),
        lambda imdb_id, media_type=None: get_ratings(imdb_id, config.MDBLIST_API_KEY, media_type),
        top250_map,
        RATINGS_QUERIED_KEY
    )


def refresh_tmdb_details():
    """
    Backfill the genres and the tagline into entries scanned before they were
    collected.

    Runs on a background thread at startup for the same reason as the IMDb
    backfill: an existing library should show the new fields without every file
    having to be rescanned by hand.
    """
    backfill_tmdb_details(
        database.scanned_files,
        database.scan_lock,
        lambda: database.save_database(config.DB_FILE),
        lambda tmdb_id, media_type: get_tmdb_details(tmdb_id, media_type, config.TMDB_API_KEY, config.CONTENT_LANGUAGE)
    )


def refresh_portraits():
    """
    Give an existing library its upright covers.

    Runs on a background thread at startup for the same reason as the other
    backfills: a library scanned before the mobile app existed carries only the
    16:9 backdrop, and cropping that to 2:3 loses most of the frame. Each entry
    is looked up once - the key is written even when neither source has cover
    art, so a title that genuinely has none is not asked again on every start.
    """
    try:
        backfill_portraits(
            database.scanned_files,
            database.scan_lock,
            lambda: database.save_database(config.DB_FILE),
            fetch_portrait_for,
            cache_portrait_for)
    except Exception as e:
        print(f"Error during portrait backfill: {e}")


def refresh_video_codecs():
    """
    Read the video codec into entries scanned before it was recorded.

    Runs on a background thread at startup for the same reason as the metadata
    backfills - an existing library should show the new field without every
    file having to be rescanned by hand. Unlike those it touches no network at
    all: it re-probes each file that carries no codec yet, and nothing else.
    """
    try:
        backfill_video_codec(
            database.scanned_files,
            database.scan_lock,
            lambda: database.save_database(config.DB_FILE))
    except Exception as e:
        print(f"Error during video codec backfill: {e}")


# Start initial scan automatically in background, reporting progress so the
# UI shows the same bar as a manual scan - and can restore it after a reload
def run_initial_scan():
    # Claimed like any other scan: it is the one scan a manual request is most
    # likely to collide with, as it runs right when the interface opens.
    if not begin_scan():
        print("Initial scan skipped: a scan is already running")
        return

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
            _progress,
            cancel_requested)
    except Exception as e:
        print(f"Error during initial scan: {e}")
        publish_scan_progress({'status': 'error', 'error': str(e)})
        return
    finally:
        was_cancelled = cancel_requested()
        end_scan()

    # Only close out the bar when there was something to show; a startup
    # with nothing new should not push a "scan finished" message at clients
    if seen['total']:
        publish_scan_progress({
            'current': seen['total'], 'total': seen['total'], 'percent': 100,
            'status': 'cancelled' if was_cancelled else 'done',
            'new_files': scanned_new or 0,
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

        # Same idea for the genres and the tagline, which older entries do not
        # carry yet
        if config.TMDB_API_KEY:
            threading.Thread(target=refresh_tmdb_details, daemon=True).start()

        # And for the upright cover the mobile app shows, which no entry
        # scanned before it existed carries at all
        if config.TMDB_API_KEY or config.FANART_API_KEY:
            threading.Thread(target=refresh_portraits, daemon=True).start()

    # Retry entries whose metadata lookups failed, so they heal themselves
    # once the API is reachable again
    if config.METADATA_RETRY_INTERVAL > 0:
        threading.Thread(target=metadata_retry_loop, daemon=True).start()
        print(f"Metadata retry every {config.METADATA_RETRY_INTERVAL} min for incomplete entries")
    else:
        print("Metadata retry disabled (METADATA_RETRY_INTERVAL=0)")

    # The codecs of an older library, read from the files themselves
    threading.Thread(target=refresh_video_codecs, daemon=True).start()

    threading.Thread(target=run_initial_scan, daemon=True).start()
    print("Initial scan started...")
