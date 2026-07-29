# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
The Server-Sent Events stream, shared by the web interface and the API.

Both surfaces stream the same events; this is the wire format they have in
common - the reconnect handling, the initial state and the keep-alive.
"""
import json
import queue

from flask import Response, request

from core.events import event_hub
from core.scan_state import scan_state, scan_state_lock

# How long a client should wait before reconnecting. Sent once at the top of the
# stream: the browser's default is only a few hundred milliseconds, which turns
# a restarting server into a reconnect storm.
RETRY_MS = 3000

# Nothing to deliver for this long and the stream sends a comment instead, so an
# idle connection is not mistaken for a dead one by a proxy in between.
KEEP_ALIVE_SECONDS = 30


def _last_event_id():
    """
    The id the client last saw, or None.

    ``EventSource`` resends it as a header on its own; a non-browser client may
    also pass it as ``?last_event_id=``, as it has to reconnect by hand anyway.
    """
    raw = request.headers.get('Last-Event-ID') or request.args.get('last_event_id')
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _format(event, data, event_id=None):
    """One event in the wire format, ready to be yielded."""
    prefix = f"id: {event_id}\n" if event_id is not None else ''
    return f"{prefix}event: {event}\ndata: {data}\n\n"


def sse_response():
    """
    A streaming response carrying scan progress and library changes.

    A reconnecting client is first handed what it missed, and every client then
    gets the current scan state - in that order, so the last word on the stream
    is the state that actually holds. Events only reach whoever is connected at
    the time, so without the snapshot a client that connects mid-scan would show
    nothing until the next file finishes. It is a ``scan_state`` event rather
    than a ``scan_progress`` one, so a consumer can tell "this is where things
    stand" from "something just happened".
    """
    last_event_id = _last_event_id()

    def event_stream():
        subscriber, missed = event_hub.subscribe(last_event_id)
        try:
            yield f"retry: {RETRY_MS}\n\n"

            for event_id, event, data in missed:
                yield _format(event, data, event_id)

            with scan_state_lock:
                snapshot = dict(scan_state)
            yield _format('scan_state', json.dumps(snapshot))

            # Blocking waits instead of polling: events are delivered the
            # moment they are published, and an idle connection costs nothing
            # beyond one keep-alive every 30 seconds.
            while True:
                try:
                    event_id, event, data = subscriber.get(timeout=KEEP_ALIVE_SECONDS)
                except queue.Empty:
                    yield ": keep-alive\n\n"
                    continue
                yield _format(event, data, event_id)
        finally:
            event_hub.unsubscribe(subscriber)

    response = Response(event_stream(), mimetype='text/event-stream')
    # Long-lived stream: never buffer or cache it on the way to the client.
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['X-Accel-Buffering'] = 'no'
    return response
