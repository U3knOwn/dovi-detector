# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
The progress of the scan that is currently running.
"""
import json
import os
import threading

from core.events import event_hub
from services import database


# Last published scan progress. Events only reach whoever is listening at that
# moment, so a page reload mid-scan would otherwise show no progress bar at
# all. This is the authoritative state /scan_status serves.
scan_state = {'status': 'idle', 'current': 0, 'total': 0, 'percent': 0, 'filename': ''}
scan_state_lock = threading.Lock()

# Whether a scan owns the scanner right now, and whether it has been asked to
# stop. Both live under scan_state_lock, so claiming a scan and reading its
# state can never disagree.
_scan_active = False
_cancel_requested = False


def begin_scan():
    """
    Claim the scanner for a new scan.

    Returns False when one is already running - two concurrent scans would walk
    the same media directory and write the same database, so the second caller
    is turned away instead of being allowed to duplicate the work.
    """
    global _scan_active, _cancel_requested
    with scan_state_lock:
        if _scan_active:
            return False
        _scan_active = True
        _cancel_requested = False
        return True


def end_scan():
    """Release the scanner. Always paired with a successful begin_scan()."""
    global _scan_active, _cancel_requested
    with scan_state_lock:
        _scan_active = False
        _cancel_requested = False


def scan_is_running():
    """Whether a scan holds the scanner right now."""
    with scan_state_lock:
        return _scan_active


def request_cancel():
    """
    Ask the running scan to stop after the files it has in flight.

    Returns False when there is nothing to cancel. The flag is only a request:
    a probe already underway is not interrupted, so the database is never left
    half-written for a file.
    """
    global _cancel_requested
    with scan_state_lock:
        if not _scan_active:
            return False
        _cancel_requested = True
        return True


def cancel_requested():
    """Whether the running scan has been asked to stop."""
    with scan_state_lock:
        return _cancel_requested


def publish_scan_progress(payload):
    """Record the progress state and push it to connected clients."""
    with scan_state_lock:
        scan_state.update(payload)
        if payload.get('status') != 'scanning':
            # A finished or failed run leaves no bar behind on the next reload
            scan_state['filename'] = ''
    try:
        event_hub.publish('scan_progress', json.dumps(payload))
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

    if result and result.get('success'):
        publish_entry_updated(file_path, result.get('file_info'))


def publish_entry_updated(file_path, file_info=None):
    """
    Tell listeners that one entry now reads differently.

    Only the path and the stamp go over the wire, not the record: a client that
    wants the new content asks for it with ``updated_since``, and a bulk scan
    does not push a megabyte of entries at every phone that happens to be
    listening.
    """
    try:
        event_hub.publish('entry_updated', json.dumps({
            'file_path': file_path,
            'updated_at': (file_info or {}).get(database.UPDATED_AT_KEY),
        }))
    except Exception as e:
        print(f"Error publishing entry update: {e}")
