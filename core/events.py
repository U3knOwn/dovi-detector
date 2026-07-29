# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Live updates for the browser (Server-Sent Events).
"""
import queue
import threading


class EventHub:
    """
    Fan Server-Sent Events out to every connected client.

    One shared queue would hand each event to whichever client happened to read
    it first, so a second browser tab silently misses updates - and it would
    grow without bound while nobody is listening at all (a 5000 file scan
    buffers 5000 payloads that are then flushed at the next visitor). Each
    subscriber therefore gets its own bounded queue: a client that cannot keep
    up drops its oldest event instead of the server growing memory.
    """

    def __init__(self, maxsize=256):
        self._maxsize = maxsize
        self._subscribers = []
        self._lock = threading.Lock()

    def publish(self, event, data):
        with self._lock:
            subscribers = list(self._subscribers)

        for subscriber in subscribers:
            try:
                subscriber.put_nowait((event, data))
            except queue.Full:
                # Slowest client wins nothing: drop its oldest event so the
                # newest state still gets through.
                try:
                    subscriber.get_nowait()
                    subscriber.put_nowait((event, data))
                except (queue.Empty, queue.Full):
                    pass

    def subscribe(self):
        subscriber = queue.Queue(maxsize=self._maxsize)
        with self._lock:
            self._subscribers.append(subscriber)
        return subscriber

    def unsubscribe(self, subscriber):
        with self._lock:
            if subscriber in self._subscribers:
                self._subscribers.remove(subscriber)


event_hub = EventHub()


class EventPublisher:
    """
    Queue-shaped adapter around the hub for the callers that only ever put.

    Keeps the watcher's ``deletion_event_queue.put(...)`` calls working while
    the events themselves are broadcast to every connected client.
    """

    def __init__(self, hub, event):
        self._hub = hub
        self._event = event

    def put(self, payload):
        self._hub.publish(self._event, payload)


deletion_event_queue = EventPublisher(event_hub, 'file_deleted')
