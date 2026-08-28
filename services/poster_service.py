# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Poster Service Module
Handles poster caching and downloading
"""
import os
import hashlib
import tempfile
from services.tmdb_service import is_valid_tmdb_url
from services.fanart_service import is_valid_fanart_url

from core.posters import delete_poster_thumbnails
from services.database import mark_updated

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False


def delete_cached_poster(file_info, poster_cache_dir):
    """
    Delete the cached images of an entry.

    Both of them: the 16:9 backdrop the web interface shows and the upright
    poster the mobile app uses are separate files, and an entry that goes takes
    each of them with it.
    """
    for field in ('poster_url', 'portrait_url'):
        _delete_cached_image(file_info.get(field, ''), poster_cache_dir)


def _delete_cached_image(image_url, poster_cache_dir):
    """Delete one cached image and every resized copy of it."""
    if not image_url or not image_url.startswith('/poster/'):
        return

    # Only the prefix - replace() would also strip a repeat of it further in
    poster_filename = image_url[len('/poster/'):]
    cached_path = os.path.join(poster_cache_dir, poster_filename)
    if os.path.exists(cached_path):
        try:
            os.remove(cached_path)
            print(f"✗ Removed cached poster: {poster_filename}")
        except Exception as e:
            print(f"Error removing poster {poster_filename}: {e}")

    # The resized copies belong to that file, so they go with it
    delete_poster_thumbnails(poster_filename)


def download_and_cache_poster(poster_url, cache_filename, poster_cache_dir):
    """Download poster image and cache it locally"""
    if not poster_url:
        return None

    # Validate URL is from TMDB or Fanart.tv to prevent SSRF attacks
    if not is_valid_tmdb_url(poster_url) and not is_valid_fanart_url(poster_url):
        print(f"  [CACHE] Invalid poster URL (not from TMDB or Fanart.tv): {poster_url}")
        return poster_url

    cache_path = os.path.join(poster_cache_dir, cache_filename)

    # Check if already cached
    if os.path.exists(cache_path):
        print(f"  [CACHE] Poster already cached: {cache_filename}")
        return f'/poster/{cache_filename}'

    try:
        print(f"  [CACHE] Downloading poster: {poster_url}")
        response = requests.get(poster_url, timeout=10)
        if response.status_code == 200:
            # Write to a unique temp file first, then atomically move it into
            # place. This keeps concurrent scans (SCAN_WORKERS > 1) safe: if two
            # files share a TMDB id and are cached at the same time, each writes
            # its own temp file and the final rename is atomic, so a partially
            # written image is never left in the cache or served.
            fd, tmp_path = tempfile.mkstemp(
                dir=poster_cache_dir, prefix=cache_filename + '.', suffix='.tmp')
            try:
                with os.fdopen(fd, 'wb') as f:
                    f.write(response.content)
                os.replace(tmp_path, cache_path)
            except Exception:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                raise
            print(f"  [CACHE] Poster cached: {cache_filename}")
            return f'/poster/{cache_filename}'
    except requests.exceptions.Timeout:
        print("  [CACHE] Timeout downloading poster")
    except requests.exceptions.RequestException as e:
        print(f"  [CACHE] Error downloading poster: {e}")
    except Exception as e:
        print(f"  [CACHE] Unexpected error caching poster: {e}")

    # Return original URL as fallback
    return poster_url


def get_cached_backdrop_path(tmdb_id, poster_url, poster_cache_dir):
    """Get cached poster path or download and cache it"""
    if not poster_url:
        return None

    # Generate cache filename based on source and TMDB ID or URL hash
    if tmdb_id:
        # Determine source from URL validation
        if is_valid_fanart_url(poster_url):
            cache_filename = f"fanart_{tmdb_id}.jpg"
        elif is_valid_tmdb_url(poster_url):
            cache_filename = f"tmdb_{tmdb_id}.jpg"
        else:
            # Fallback to hash-based naming for unknown sources
            url_hash = hashlib.md5(poster_url.encode()).hexdigest()
            cache_filename = f"poster_{url_hash}.jpg"
    else:
        # Extract filename from URL using hash
        url_hash = hashlib.md5(poster_url.encode()).hexdigest()
        cache_filename = f"poster_{url_hash}.jpg"

    return download_and_cache_poster(poster_url, cache_filename, poster_cache_dir)


def get_cached_portrait_path(tmdb_id, portrait_url, poster_cache_dir):
    """
    Cache the upright poster, under a name of its own.

    The backdrop and the portrait of one title are two different images, so
    they cannot share a cache name - hence the ``_portrait`` in it. Everything
    else works exactly as it does for the backdrop, down to the SSRF check on
    the source.
    """
    if not portrait_url:
        return None

    if tmdb_id:
        if is_valid_fanart_url(portrait_url):
            cache_filename = f"fanart_portrait_{tmdb_id}.jpg"
        elif is_valid_tmdb_url(portrait_url):
            cache_filename = f"tmdb_portrait_{tmdb_id}.jpg"
        else:
            url_hash = hashlib.md5(portrait_url.encode()).hexdigest()
            cache_filename = f"portrait_{url_hash}.jpg"
    else:
        url_hash = hashlib.md5(portrait_url.encode()).hexdigest()
        cache_filename = f"portrait_{url_hash}.jpg"

    return download_and_cache_poster(portrait_url, cache_filename, poster_cache_dir)


def fetch_portrait(tmdb_id, *lookups):
    """
    Find the upright poster for a title, wherever it can be had.

    The ``lookups`` are asked in the order they are given, and that order is the
    configured ``IMAGE_SOURCE`` preference: a library set to Fanart.tv asks
    Fanart.tv first and only falls back to TMDB for the titles Fanart.tv has no
    cover art for, and the other way round. Returns the remote URL, or None when
    no source has one - which is a real answer, not a failure, and leaves the
    entry showing its placeholder.
    """
    if not tmdb_id:
        return None

    for lookup in lookups:
        if not lookup:
            continue
        for media_type in ('movie', 'tv'):
            portrait_url = lookup(tmdb_id, media_type)
            if portrait_url:
                return portrait_url

    return None


# The ``IMAGE_SOURCE`` preference an entry's cover was last resolved under.
# Not the source the cover actually came from: a title Fanart.tv has no cover
# for is answered by TMDB and still counts as resolved under 'fanart', so it is
# not asked again on every start. What it does catch is the preference itself
# changing - see _portrait_needs_lookup below.
PORTRAIT_SOURCE_KEY = 'portrait_source'


def _portrait_needs_lookup(file_info, source_pref):
    """
    True when an entry's upright cover still has to be looked up.

    Two cases. It was never looked up at all - a library scanned before the
    field existed. Or it was resolved under a different ``IMAGE_SOURCE`` than
    the one now configured: switching the preference has to move the covers
    with it, or a library switched to Fanart.tv would keep the TMDB covers it
    was first scanned with forever.
    """
    if 'portrait_url' not in file_info:
        return True

    return source_pref is not None and file_info.get(PORTRAIT_SOURCE_KEY) != source_pref


def backfill_portraits(scanned_files, scan_lock, save_database_func,
                       fetch_portrait_func, cache_portrait_func,
                       source_pref=None):
    """
    Give the entries of an existing library their upright poster.

    Without this only newly scanned titles would have one, and a library built
    before the mobile app existed would show nothing but backdrops cropped to
    2:3. Entries are looked up once per ``source_pref``: the key is written
    even when no source has a poster, so a title that genuinely has none is not
    asked again on every start, and a run only repeats itself after the
    ``IMAGE_SOURCE`` preference has actually changed.
    """
    if not REQUESTS_AVAILABLE or not fetch_portrait_func:
        return 0

    with scan_lock:
        entries = [info for info in scanned_files.values()
                   if info.get('tmdb_id') and _portrait_needs_lookup(info, source_pref)]

    if not entries:
        return 0

    filled = 0
    for file_info in entries:
        tmdb_id = file_info.get('tmdb_id')
        portrait_url = fetch_portrait_func(tmdb_id)
        if portrait_url and cache_portrait_func:
            portrait_url = cache_portrait_func(tmdb_id, portrait_url)

        file_info['portrait_url'] = portrait_url
        file_info[PORTRAIT_SOURCE_KEY] = source_pref
        mark_updated(file_info)
        if portrait_url:
            filled += 1

    with scan_lock:
        save_database_func()
    print(f"✓ Portrait posters updated - {filled} of {len(entries)} entr(ies)")

    return filled


def migrate_poster_urls_to_cache(scanned_files, scan_lock, save_database_func, poster_cache_dir):
    """Migrate existing TMDB and Fanart.tv poster URLs to cached versions"""
    if not REQUESTS_AVAILABLE:
        return

    migrated_count = 0
    with scan_lock:
        for file_path, file_info in scanned_files.items():
            tmdb_id = file_info.get('tmdb_id')

            # Both images take the same route: a URL still pointing at TMDB or
            # Fanart.tv is one whose download did not happen or did not finish,
            # and it gets another go here.
            for field, cache in (('poster_url', get_cached_backdrop_path),
                                 ('portrait_url', get_cached_portrait_path)):
                image_url = file_info.get(field)
                if not image_url:
                    continue
                if not (is_valid_tmdb_url(image_url) or is_valid_fanart_url(image_url)):
                    continue

                print(
                    f"  [MIGRATION] Caching {field} for: "
                    f"{file_info.get('filename')}")
                cached_path = cache(tmdb_id, image_url, poster_cache_dir)
                if cached_path and cached_path.startswith('/poster/'):
                    file_info[field] = cached_path
                    mark_updated(file_info)
                    migrated_count += 1

        if migrated_count > 0:
            save_database_func()
            print(f"✓ Migrated {migrated_count} poster(s) to cache")
