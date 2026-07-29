# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Live updates for the browser (Server-Sent Events).
"""
import collections
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

    Every event also carries an id and is kept in a bounded history, so a client
    whose connection dropped can name the last id it saw and be handed what it
    missed instead of having to reconcile from scratch.
    """

    def __init__(self, maxsize=256, history=256):
        self._maxsize = maxsize
        self._subscribers = []
        self._lock = threading.Lock()
        self._history = collections.deque(maxlen=history)
        self._next_id = 1

    def publish(self, event, data):
        with self._lock:
            event_id = self._next_id
            self._next_id += 1
            self._history.append((event_id, event, data))
            subscribers = list(self._subscribers)

        for subscriber in subscribers:
            try:
                subscriber.put_nowait((event_id, event, data))
            except queue.Full:
                # Slowest client wins nothing: drop its oldest event so the
                # newest state still gets through.
                try:
                    subscriber.get_nowait()
                    subscriber.put_nowait((event_id, event, data))
                except (queue.Empty, queue.Full):
                    pass

    def subscribe(self, last_event_id=None):
        """
        Listen in. Returns ``(subscriber, missed)``.

        ``subscriber`` is a queue receiving every event from here on; ``missed``
        is what the history still holds beyond ``last_event_id`` - the reconnect
        case. Both are taken under one lock, so an event published in between
        lands in exactly one of them: neither lost nor delivered twice. An id
        from a previous run of the process replays nothing, as the history starts
        empty again - which is why a client is also sent the current state.
        """
        subscriber = queue.Queue(maxsize=self._maxsize)
        missed = []
        with self._lock:
            if last_event_id is not None:
                missed = [entry for entry in self._history if entry[0] > last_event_id]
            self._subscribers.append(subscriber)
        return subscriber, missed

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
