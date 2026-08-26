# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Database operations module for managing scanned files
"""
import os
import json
import tempfile
import threading
import time

# Global data storage
scanned_files = {}
scanned_paths = set()

# When an entry was last written, as seconds since the epoch. Stamped on every
# change - a scan, a rescan, a backfill filling in a poster or a rating - so a
# client can ask for "everything since" instead of pulling the whole library
# on every start. The file's own mtime cannot answer that: filling in a rating
# never touches the file.
UPDATED_AT_KEY = 'updated_at'

# Bumped with every change to the library, so an unchanged one can be answered
# with 304 rather than with megabytes. Seeded from the clock rather than from
# zero: a restart must not hand out a revision a client already holds an ETag
# for, or it would keep a stale library forever.
_revision = int(time.time())
# Reentrant so save_database() can take a consistent snapshot under the lock
# even when a caller already holds it (e.g. the scanner, the watcher and
# cleanup_database all save while mutating under this same lock).
scan_lock = threading.RLock()


def library_revision():
    """The library's current revision, for a caller building an ETag."""
    with scan_lock:
        return _revision


def bump_revision():
    """
    Note that the library changed without one entry being the reason - an
    entry removed, the whole thing cleared.
    """
    global _revision
    with scan_lock:
        _revision += 1


def mark_updated(file_info):
    """
    Stamp an entry as changed now, and note the change in the revision.

    Every write to an entry goes through here, whatever wrote it, so
    ``updated_since`` and the ETag stay true to what actually happened.
    """
    global _revision
    with scan_lock:
        file_info[UPDATED_AT_KEY] = time.time()
        _revision += 1
    return file_info


def load_database(db_file):
    """Load previously scanned files from database"""
    global scanned_files, scanned_paths
    try:
        if os.path.exists(db_file):
            with open(db_file, 'r') as f:
                data = json.load(f)
                scanned_files = data.get('files', {})
                scanned_paths = set(data.get('paths', []))
                bump_revision()
                print(f"Loaded {len(scanned_files)} files from database")
    except Exception as e:
        print(f"Error loading database: {e}")
        scanned_files = {}
        scanned_paths = set()


def save_database(db_file):
    """
    Save scanned files to database atomically.

    The whole operation - snapshot, write, swap - runs under ``scan_lock`` so
    the on-disk file always reflects a consistent point-in-time and concurrent
    savers can never race a stale snapshot onto disk (the lock is reentrant, so
    callers that already hold it while mutating can save without deadlocking).
    The JSON is written to a temp file in the same directory and swapped into
    place with ``os.replace``; that way an interrupted write - container killed
    mid-scan, disk full - can never leave a half-written / corrupt database
    behind, and the previous good copy stays intact. Saves are batched and
    small, so holding the lock across the write costs next to nothing.
    """
    tmp_path = None
    try:
        with scan_lock:
            dir_name = os.path.dirname(db_file) or '.'
            fd, tmp_path = tempfile.mkstemp(
                dir=dir_name, prefix='.scanned_files_', suffix='.tmp')
            # Serialized straight into the file rather than into an
            # intermediate string: a large library is several megabytes of
            # JSON, which would otherwise be held in memory in full on every
            # save (and a bulk scan saves repeatedly).
            with os.fdopen(fd, 'w') as f:
                json.dump({
                    'files': scanned_files,
                    'paths': list(scanned_paths)
                }, f, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, db_file)
            tmp_path = None
    except Exception as e:
        print(f"Error saving database: {e}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def cleanup_database(db_file, delete_cached_poster_func):
    """Remove entries from database for files that no longer exist"""
    removed_count = 0
    paths_to_remove = []

    # Get list of paths to check (with lock)
    with scan_lock:
        paths_to_check = list(scanned_files.keys())

    # Check which files no longer exist (outside lock to avoid blocking)
    for file_path in paths_to_check:
        if not os.path.exists(file_path):
            paths_to_remove.append(file_path)

    # Remove non-existent files from database (with lock)
    if paths_to_remove:
        with scan_lock:
            for file_path in paths_to_remove:
                if file_path in scanned_files:  # Check if still exists in case another thread already removed it
                    file_info = scanned_files[file_path]

                    # Delete cached poster if it exists
                    delete_cached_poster_func(file_info)

                    del scanned_files[file_path]
                    scanned_paths.discard(file_path)
                    bump_revision()
                    removed_count += 1
                    print(
                        f"✗ Removed from database (file not found): {file_path}")

            if removed_count > 0:
                save_database(db_file)

    return removed_count
