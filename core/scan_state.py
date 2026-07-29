# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
The progress of the scan that is currently running.
"""
import json
import os
import threading

from core.events import event_hub


# Last published scan progress. Events only reach whoever is listening at that
# moment, so a page reload mid-scan would otherwise show no progress bar at
# all. This is the authoritative state /scan_status serves.
scan_state = {'status': 'idle', 'current': 0, 'total': 0, 'percent': 0, 'filename': ''}
scan_state_lock = threading.Lock()


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
