# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
The Server-Sent Events stream the page listens on.
"""
import queue

from flask import Blueprint, Response

from core.events import event_hub

bp = Blueprint('events', __name__)


@bp.route('/events')
def events():
    """Server-Sent Events endpoint for real-time updates"""
    def event_stream():
        subscriber = event_hub.subscribe()
        try:
            # Blocking waits instead of polling: events are delivered the
            # moment they are published, and an idle connection costs nothing
            # beyond one keep-alive every 30 seconds.
            while True:
                try:
                    event, data = subscriber.get(timeout=30)
                except queue.Empty:
                    yield ": keep-alive\n\n"
                    continue
                yield f"event: {event}\ndata: {data}\n\n"
        finally:
            event_hub.unsubscribe(subscriber)

    response = Response(event_stream(), mimetype='text/event-stream')
    # Long-lived stream: never buffer or cache it on the way to the client.
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['X-Accel-Buffering'] = 'no'
    return response
