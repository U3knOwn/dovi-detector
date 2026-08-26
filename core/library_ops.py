# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
What can be done with the library, without any HTTP around it.

Both the web interface's endpoints and the versioned API in routes/api_v1.py
call these, so the two surfaces cannot drift apart: an entry deleted through
the API goes through exactly the same steps as one deleted in the browser.
"""
import json
import os
import re
import threading

import config
from core.events import deletion_event_queue
from core.scan_state import (begin_scan, cancel_requested, end_scan,
                             publish_scan_progress, report_scan_progress)
from core.scanner import delete_cached_poster_for, scan_video_file_with_deps
from services import database
from services.video_scanner import (RESOLUTION_NAMES, bulk_scan_files,
                                    scan_directory)

# The fields the library view and the API hand out. Everything else an entry
# carries (the raw DV profile, the IMDb vote count) is not shown anywhere, so
# it is not shipped to every caller either.
LIBRARY_FIELDS = (
    'filename', 'path', 'hdr_format', 'hdr_detail', 'el_type', 'resolution',
    'resolution_class', 'video_codec', 'video_codec_profile', 'video_encoder',
    'audio_codec', 'duration', 'video_bitrate', 'audio_bitrate', 'file_size',
    'mtime', 'dv_cm_version', 'hdr_metadata', 'tmdb_id', 'poster_url',
    'tmdb_title', 'tmdb_year', 'tmdb_rating', 'tmdb_plot', 'tmdb_tagline',
    'tmdb_directors', 'tmdb_cast', 'tmdb_genres', 'imdb_id', 'imdb_rating',
    'rt_rating', 'rt_audience', 'trakt_rating', 'metacritic', 'imdb_top250',
)

# The fields a caller may narrow the library down by. Compared case-insensitively
# against the value stored in the entry, so ``hdr_format=dolby vision`` matches
# every Dolby Vision title and ``el_type=FEL`` picks its enhancement layer.
LIBRARY_FILTERS = ('hdr_format', 'el_type', 'resolution', 'resolution_class',
                   'video_codec', 'video_encoder', 'audio_codec')

# Where a text search looks. Both, because an entry may carry a title that the
# file name does not and the other way round.
SEARCH_FIELDS = ('filename', 'tmdb_title')


# The class a resolution belongs to, for the counts below the table. A library
# is browsed in these four or five steps, not in the dozen exact frame sizes a
# scan can report.
RESOLUTION_CLASSES = {
    '8K (UHD)': '8K',
    '4K DCI': '4K',
    '4K (UHD)': '4K',
    '1440p': 'QHD',
    '1080p (Full HD)': 'FHD',
    '768p': 'HD',
    '720p (HD)': 'HD',
    '480p (SD)': 'SD',
}

# The smallest frame each class starts at, largest first.
RESOLUTION_CLASS_STEPS = (
    (7680, '8K'),
    (3840, '4K'),
    (2560, 'QHD'),
    (1920, 'FHD'),
    (1280, 'HD'),
    (1, 'SD'),
)

# The order the classes are shown in, best first.
RESOLUTION_CLASS_ORDER = ('8K', '4K', 'QHD', 'FHD', 'HD', 'SD', 'Unknown')

_FRAME_SIZE = re.compile(r'^(\d+)\s*x\s*(\d+)$')

# Video codecs, most current first - the same rank the interface sorts by, so a
# caller can ask for the order it sees on screen. Mirrors VIDEO_CODEC_ORDER in
# static/js/helpers/ranking.js; the two have to agree.
VIDEO_CODEC_ORDER = (
    'H.266', 'H.265', 'AV1', 'H.264', 'VC-1', 'VP9', 'VP8',
    'MPEG-4', 'MPEG-2', 'MPEG-1',
)

# How many pixels each named resolution holds, for ordering two entries of the
# same class. Read off the names the scanner produced rather than written out
# again; where two frames share a name (480p), the larger one stands for it.
RESOLUTION_PIXELS = {}
for (_width, _height), _name in RESOLUTION_NAMES.items():
    RESOLUTION_PIXELS[_name] = max(RESOLUTION_PIXELS.get(_name, 0), _width * _height)


def resolution_pixels(resolution):
    """
    The frame a resolution stands for, in pixels - 0 when it is not a frame.

    A named resolution is looked up, a bare ``1920x800`` is multiplied out.
    """
    name = str(resolution or '').strip()
    if name in RESOLUTION_PIXELS:
        return RESOLUTION_PIXELS[name]

    match = _FRAME_SIZE.match(name)
    return int(match.group(1)) * int(match.group(2)) if match else 0


def video_codec_rank(video_codec):
    """
    Where a codec sits in VIDEO_CODEC_ORDER; anything unlisted ranks behind
    all of them.
    """
    name = str(video_codec or '').strip()
    return VIDEO_CODEC_ORDER.index(name) if name in VIDEO_CODEC_ORDER else len(VIDEO_CODEC_ORDER)


def resolution_class(resolution):
    """
    Which of SD / HD / FHD / QHD / 4K / 8K a resolution counts as.

    Named resolutions map straight to their class. A frame size without a name
    of its own ("3840x1600") is measured by its long side, widened to what the
    frame would be at 16:9 - so a scope crop still counts as the class it was
    mastered in, and an anamorphic 1440x1080 as FHD rather than HD. Returns
    "Unknown" for an entry whose resolution was never determined.
    """
    name = str(resolution or '').strip()
    if not name or name == 'Unknown':
        return 'Unknown'

    known = RESOLUTION_CLASSES.get(name)
    if known:
        return known

    match = _FRAME_SIZE.match(name)
    if not match:
        return 'Unknown'

    width, height = int(match.group(1)), int(match.group(2))
    if not width or not height:
        return 'Unknown'
    measure = max(max(width, height), min(width, height) * 16 // 9)

    for minimum, label in RESOLUTION_CLASS_STEPS:
        if measure >= minimum:
            return label
    return 'Unknown'


def _text(value):
    """A field's value as comparable text - an entry may hold anything or None."""
    return str(value).strip().lower() if value is not None else ''


def _as_float(value):
    """A number to sort by, for a field an entry may not carry at all."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


# The orders a caller may ask for. A missing value sorts as 0 (or as the empty
# string) rather than making the comparison fail.
SORT_KEYS = {
    'filename': lambda entry: _text(entry.get('filename')),
    'tmdb_title': lambda entry: _text(entry.get('tmdb_title')),
    'mtime': lambda entry: _as_float(entry.get('mtime')),
    'file_size': lambda entry: _as_float(entry.get('file_size')),
    'duration': lambda entry: _as_float(entry.get('duration')),
    'tmdb_year': lambda entry: _as_float(entry.get('tmdb_year')),
    'tmdb_rating': lambda entry: _as_float(entry.get('tmdb_rating')),
    'imdb_rating': lambda entry: _as_float(entry.get('imdb_rating')),
    # The same rating sources the interface sorts by, so an API consumer can ask
    # for the order it sees on screen instead of sorting the library itself.
    'rt_rating': lambda entry: _as_float(entry.get('rt_rating')),
    'rt_audience': lambda entry: _as_float(entry.get('rt_audience')),
    'trakt_rating': lambda entry: _as_float(entry.get('trakt_rating')),
    'metacritic': lambda entry: _as_float(entry.get('metacritic')),
    # Class before frame, so ``desc`` puts every 4K title together whatever its
    # crop and a scope-cropped 3840x1600 does not land between two plain UHD -
    # exactly the order the interface shows. Negated because the class list runs
    # best-first while a sort key has to grow with the value: ``asc`` then
    # starts at the entries whose resolution was never determined.
    'resolution': lambda entry: (
        -RESOLUTION_CLASS_ORDER.index(resolution_class(entry.get('resolution'))),
        resolution_pixels(entry.get('resolution'))),
    # Same idea for the codec: ``desc`` is the newest first, ``asc`` the oldest.
    'video_codec': lambda entry: -video_codec_rank(entry.get('video_codec')),
}


def _as_entry(file_info):
    """One database record as its consumers see it: a compact, fixed shape."""
    entry = {field: file_info.get(field) for field in LIBRARY_FIELDS}

    # Derived rather than stored: the class follows from the resolution, and a
    # caller that wants "everything still below 4K" should not have to know
    # which frame sizes that covers.
    entry['resolution_class'] = resolution_class(entry.get('resolution'))

    # Modification time for the "recently added" sort. Scanning records it,
    # so only entries from an older database still need a stat call here -
    # which matters on a large library, where thousands of stats on network
    # storage would otherwise be paid on every request.
    if not entry.get('mtime'):
        try:
            entry['mtime'] = os.path.getmtime(entry.get('path') or '')
        except (OSError, TypeError):
            entry['mtime'] = 0

    return entry


def list_entries():
    """
    The library as its consumers see it: one compact record per entry.

    Snapshotted under the lock, because a scan or the watcher may be mutating
    the database right now and iterating it while it changes size raises.
    """
    with database.scan_lock:
        snapshot = list(database.scanned_files.values())

    entries = [_as_entry(file_info) for file_info in snapshot]
    entries.sort(key=lambda x: x.get('filename') or '')
    return entries


def get_entry(file_path):
    """
    One entry by its path, or None when the library does not know it.

    So a caller after a single title does not have to pull the whole library to
    find it.
    """
    with database.scan_lock:
        file_info = database.scanned_files.get(file_path)
        if file_info is None:
            return None
        file_info = dict(file_info)

    return _as_entry(file_info)


def query_entries(filters=None, search=None, sort='filename', order='asc',
                  limit=None, offset=0):
    """
    A slice of the library: filtered, sorted, and cut to a window.

    Returns ``(entries, total)``, where ``total`` counts everything that matched
    before the window was applied - a caller paging through needs to know how far
    it has to go. Filtering here rather than at the caller is the point: a
    dashboard after the Dolby Vision titles should not have to download a library
    of thousands to find them.

    Raises ValueError for a sort field or order that does not exist.
    """
    if sort not in SORT_KEYS:
        raise ValueError(f'Unknown sort field: {sort}')
    if order not in ('asc', 'desc'):
        raise ValueError(f'Unknown order: {order}')

    entries = list_entries()

    for field, wanted in (filters or {}).items():
        wanted = _text(wanted)
        entries = [e for e in entries if _text(e.get(field)) == wanted]

    if search:
        needle = _text(search)
        entries = [
            e for e in entries
            if any(needle in _text(e.get(field)) for field in SEARCH_FIELDS)
        ]

    total = len(entries)

    entries.sort(key=SORT_KEYS[sort], reverse=(order == 'desc'))

    if offset:
        entries = entries[offset:]
    if limit is not None:
        entries = entries[:limit]

    return entries, total


def entry_count():
    """How many entries the library holds."""
    with database.scan_lock:
        return len(database.scanned_files)


def library_summary():
    """
    Counts per HDR format, resolution, video codec and audio codec plus the
    total.

    Resolutions are counted twice over: once per exact frame size, and once per
    class (SD / HD / FHD / QHD / 4K / 8K) - the latter is what the interface
    shows below the table, and what a dashboard usually wants as well.

    This is what a dashboard wants: the numbers without the megabytes of the
    full library behind them.
    """
    with database.scan_lock:
        snapshot = list(database.scanned_files.values())

    formats = {}
    resolutions = {}
    resolution_classes = {}
    video = {}
    audio = {}
    total_size = 0

    for file_info in snapshot:
        hdr_format = file_info.get('hdr_format') or 'Unknown'
        el_type = file_info.get('el_type')
        # A Dolby Vision title is counted under its enhancement layer, which is
        # the distinction the interface makes as well
        if hdr_format == 'Dolby Vision' and el_type:
            hdr_format = f'Dolby Vision ({el_type})'
        formats[hdr_format] = formats.get(hdr_format, 0) + 1

        resolution = file_info.get('resolution') or 'Unknown'
        resolutions[resolution] = resolutions.get(resolution, 0) + 1

        size_class = resolution_class(resolution)
        resolution_classes[size_class] = resolution_classes.get(size_class, 0) + 1

        video_codec = file_info.get('video_codec') or 'Unknown'
        video[video_codec] = video.get(video_codec, 0) + 1

        codec = file_info.get('audio_codec') or 'Unknown'
        audio[codec] = audio.get(codec, 0) + 1

        try:
            total_size += int(file_info.get('file_size') or 0)
        except (TypeError, ValueError):
            pass

    def by_count(counts):
        return dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))

    return {
        'total': len(snapshot),
        'total_size': total_size,
        'hdr_formats': by_count(formats),
        'resolutions': by_count(resolutions),
        # Best first rather than by count, so the classes read in the same
        # order however a library happens to be made up. Only a caller using
        # this function directly sees that: Flask sorts the keys of a JSON
        # object on the way out, so nothing over HTTP may rely on it.
        'resolution_classes': {
            label: resolution_classes[label]
            for label in RESOLUTION_CLASS_ORDER if label in resolution_classes
        },
        'video_codecs': by_count(video),
        'audio_codecs': by_count(audio),
    }


def list_media_files():
    """
    Every video file below the media directory, with whether it was scanned.

    Unscanned files come first so a caller immediately sees what is still
    missing, then by name (A-Z, case-insensitive) within each group.
    """
    all_files = []
    for root, _dirs, files in os.walk(config.MEDIA_PATH):
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext in config.SUPPORTED_FORMATS:
                file_path = os.path.join(root, file)
                all_files.append({
                    'path': file_path,
                    'name': file,  # Only filename, not path
                    'scanned': file_path in database.scanned_paths
                })

    all_files.sort(key=lambda x: (x['scanned'], x['name'].lower()))
    return all_files


def _run_scan(file_paths, removed_count=0):
    """
    Scan the given files, reporting progress the way the interface expects.

    Runs on the caller's thread - start_full_scan / start_scan_of put it on a
    background one.
    """
    try:
        total = len(file_paths)

        if total == 0:
            publish_scan_progress({
                'current': 0, 'total': 0, 'percent': 0,
                'status': 'done', 'new_files': 0,
                'removed_files': removed_count,
                'total_files': entry_count()
            })
            return

        # Batched DB writes, optional parallelism, progress streamed to every
        # listener as each file finishes. A cancelled run stops between files.
        scanned_new_count = bulk_scan_files(
            file_paths,
            scan_video_file_with_deps,
            lambda: database.save_database(config.DB_FILE),
            config.SCAN_WORKERS,
            report_scan_progress,
            cancel_requested)

        # A cancelled scan is not a failed one: what it did get through is in the
        # library, and saying so is the difference between "finished" and
        # "stopped after 40 of 900" for whoever is watching.
        publish_scan_progress({
            'current': total, 'total': total, 'percent': 100,
            'status': 'cancelled' if cancel_requested() else 'done',
            'new_files': scanned_new_count,
            'removed_files': removed_count,
            'total_files': entry_count()
        })
    except Exception as e:
        publish_scan_progress({'status': 'error', 'error': str(e)})


def start_full_scan():
    """
    Drop entries whose files are gone, then scan everything new.

    Returns False when a scan is already running, in which case nothing is
    started: two scans over the same media directory would duplicate every probe
    and fight over the database.
    """
    if not begin_scan():
        return False

    def _job():
        try:
            removed_count = database.cleanup_database(config.DB_FILE, delete_cached_poster_for)
            new_files = scan_directory(config.MEDIA_PATH, database.scanned_paths)
            _run_scan(new_files, removed_count)
        except Exception as e:
            publish_scan_progress({'status': 'error', 'error': str(e)})
        finally:
            end_scan()

    threading.Thread(target=_job, daemon=True).start()
    return True


def start_scan_of(file_paths):
    """
    Scan the given paths in the background.

    Paths that no longer exist are dropped, the given order is kept. Files that
    are already known are skipped by the scanner itself, so handing it
    everything effectively scans only what is still missing. Returns how many
    paths were accepted, or None when a scan is already running.
    """
    if not begin_scan():
        return None

    valid_paths = [p for p in file_paths if isinstance(p, str) and os.path.exists(p)]

    def _job():
        try:
            _run_scan(valid_paths)
        finally:
            end_scan()

    threading.Thread(target=_job, daemon=True).start()
    return len(valid_paths)


def scan_file(file_path):
    """
    Scan one file and wait for the result.

    Returns the scanner's result dict, or None when it produced nothing.
    Raises FileNotFoundError when the path does not exist.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(file_path)
    return scan_video_file_with_deps(file_path)


def rescan_entry(file_path):
    """
    Re-read one entry from scratch: probe the file again and redo every online
    lookup.

    Returns the fresh entry, or None when the scan failed - in which case the
    previous record is put back, so an entry never silently vanishes. Raises
    FileNotFoundError when the file is gone.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(file_path)

    # Drop the old record first - the scanner skips paths it already knows, and
    # the cached poster is replaced by the fresh one.
    with database.scan_lock:
        old_info = database.scanned_files.pop(file_path, None)
        database.scanned_paths.discard(file_path)
    if old_info:
        delete_cached_poster_for(old_info)

    result = scan_video_file_with_deps(file_path)
    if result and result.get('success'):
        return result.get('file_info')

    if old_info:
        with database.scan_lock:
            database.scanned_files[file_path] = old_info
            database.scanned_paths.add(file_path)
            database.save_database(config.DB_FILE)
    return None


def delete_entry(file_path):
    """
    Remove one entry and its cached poster.

    Returns True when it was removed, False when the library did not know it.
    """
    with database.scan_lock:
        file_info = database.scanned_files.get(file_path)
        if file_info is None:
            return False

        delete_cached_poster_for(file_info)
        del database.scanned_files[file_path]
        database.scanned_paths.discard(file_path)
        database.save_database(config.DB_FILE)

    _notify({'file_path': file_path})
    return True


def clear_library():
    """Empty the database and delete every cached poster."""
    with database.scan_lock:
        for file_info in list(database.scanned_files.values()):
            try:
                delete_cached_poster_for(file_info)
            except Exception as e:
                print(f"Error deleting poster for {file_info.get('filename')}: {e}")

        database.scanned_files.clear()
        database.scanned_paths.clear()
        database.save_database(config.DB_FILE)

    _notify({'cleared': True})


def _notify(payload):
    """Tell connected clients that the library changed."""
    try:
        deletion_event_queue.put(json.dumps(payload))
    except Exception as e:
        print(f"Error queuing library event: {e}")
