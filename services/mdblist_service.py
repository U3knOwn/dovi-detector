# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
MDBList Integration Service

MDBList (https://api.mdblist.com/) answers with every rating a title has - IMDb,
Rotten Tomatoes tomatometer *and* audience score, Trakt and Metacritic - in a
single request. The free tier allows 1000 requests per day, so one request per
title is all the ratings cost.

The key is optional: without it no lookup happens at all and the interface falls
back to the TMDB rating. A failing request never aborts a scan.
"""
import threading
import time

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

from services.imdb_service import is_valid_imdb_id

MDBLIST_API_URL = 'https://api.mdblist.com/'

# The endpoint that reports the ratings of one title:
#   /{provider}/{media_type}/{id}/  ->  /imdb/movie/tt0453467/
# The trailing slash is what MDBList's own routes are declared with; without it
# the request only arrives after a redirect, which some proxies answer instead of
# passing on. A series lives under 'show', not 'movie'.
MDBLIST_MEDIA_TYPES = ('movie', 'show')

# Reports what the key is worth: whether it is accepted at all, and how much of
# the daily request budget is already spent. Used for the startup check, which is
# the only place that tells "the key is wrong" apart from "the titles have no
# ratings" before a whole library has been walked.
MDBLIST_USER_URL = f'{MDBLIST_API_URL}user'

MDBLIST_TIMEOUT = 15

# MDBList rate-limits a free key per second as well as per day. One request per
# second is the pace its own clients keep, and every lookup here happens in a
# background thread, so waiting is cheaper than being turned away.
_MIN_REQUEST_INTERVAL = 1.0

# Once the daily budget is spent every further request is refused, so asking
# again for each of a few thousand titles only burns time. The limit is
# remembered for this long and the lookups resume by themselves afterwards -
# the entries stay marked as "not asked yet" and are retried.
_LIMIT_COOLDOWN = 30 * 60

# The errors MDBList reports when a budget is exhausted rather than when it does
# not know a title.
_LIMIT_ERRORS = ('limit reached', 'rate limit')

# One rating source can be spelled differently across MDBList's endpoints
# ('tomatoesaudience' and 'popcorn' are both the audience score), so every
# accepted spelling is listed rather than assumed.
_IMDB_SOURCES = ('imdb',)
_RT_SOURCES = ('tomatoes',)
_RT_AUDIENCE_SOURCES = ('tomatoesaudience', 'popcorn', 'audience')
_TRAKT_SOURCES = ('trakt',)
_METACRITIC_SOURCES = ('metacritic',)

# Answer states of a single request. Only OK carries data; UNKNOWN is MDBList
# saying it has no such title under that media type, which is worth trying the
# other one; NO_ANSWER means the question did not get through and has to be
# asked again later.
_OK = 'ok'
_UNKNOWN = 'unknown'
_NO_ANSWER = 'no_answer'

_throttle_lock = threading.Lock()
_last_request_at = 0.0
_limit_lock = threading.Lock()
_limit_until = 0.0


def get_mdblist_ratings(imdb_id, mdblist_api_key, media_type=None):
    """
    Fetch every rating MDBList knows for an IMDb id in a single request.

    Returns a dict with ``imdb_rating`` (float, 0-10), ``imdb_votes`` (int),
    ``rt_rating`` (int, Rotten Tomatoes tomatometer in percent), ``rt_audience``
    (int, Rotten Tomatoes audience score in percent), ``trakt_rating`` (int,
    Trakt score in percent) and ``metacritic`` (int, Metascore out of 100).
    Individual entries are None when that rating does not exist for the title,
    and so are all of them when MDBList knows the title but has no rating for
    it at all.

    Returns None when the lookup produced no answer (no key, network error,
    daily budget spent) - the caller uses that to tell "nothing to show" apart
    from "not asked yet" and retry later.

    ``media_type`` is 'movie' or 'tv'/'show' when the caller already knows which
    one the title is; that saves the wrong guess and with it one request out of
    the daily budget. Without it a movie is tried first and a series second.
    """
    if not mdblist_api_key or not REQUESTS_AVAILABLE:
        return None

    if not is_valid_imdb_id(imdb_id):
        print(f"  [MDBList] Invalid IMDb ID: {imdb_id}")
        return None

    imdb_id = str(imdb_id).strip()

    if _limit_is_active():
        return None

    for candidate in _media_types(media_type):
        state, data = _request(_item_url(candidate, imdb_id), mdblist_api_key)

        if state == _OK:
            ratings = data.get('ratings')
            if not isinstance(ratings, list):
                # An answer without a ratings list is not this endpoint's
                # answer - storing empty ratings for it would mark the title as
                # asked and never look again.
                print(f"  [MDBList] Unexpected answer for {imdb_id} "
                      f"(no ratings list) - retried later")
                return None
            return _parse_ratings(ratings)

        if state == _NO_ANSWER:
            return None

    # Both media types were answered with "no such title". That is a real answer
    # and is stored as "has no ratings", so the title is not asked again daily.
    print(f"  [MDBList] {imdb_id} is unknown to MDBList - no ratings")
    return {}


def verify_mdblist_key(mdblist_api_key):
    """
    Check the configured key against MDBList and report what it is worth.

    Returns the answer of the ``user`` endpoint (the daily request budget and
    how much of it is used) or None when the key was refused or unreachable.
    Called once at startup: a key MDBList does not accept otherwise looks
    exactly like a library whose titles happen to have no ratings.
    """
    if not mdblist_api_key or not REQUESTS_AVAILABLE:
        return None

    state, data = _request(MDBLIST_USER_URL, mdblist_api_key)
    if state != _OK:
        print("⚠ Warning: MDBLIST_API_KEY was not accepted by MDBList - "
              "no ratings will be fetched (get a key at "
              "https://mdblist.com/preferences/)")
        return None

    used = data.get('api_requests_count')
    total = data.get('api_requests')
    if used is not None and total is not None:
        print(f"✓ MDBList key accepted - {used}/{total} requests used today")
    else:
        print("✓ MDBList key accepted")
    return data


def _item_url(media_type, imdb_id):
    """The ratings endpoint of one title."""
    return f'{MDBLIST_API_URL}imdb/{media_type}/{imdb_id}/'


def _media_types(media_type):
    """
    The media types to try, in order.

    A caller that knows the type ('movie', or 'tv'/'show' for a series) gets
    exactly that one; everything else falls back to trying both.
    """
    normalized = str(media_type or '').strip().lower()
    if normalized == 'movie':
        return ('movie',)
    if normalized in ('tv', 'show', 'series'):
        return ('show',)
    return MDBLIST_MEDIA_TYPES


def _request(url, mdblist_api_key):
    """
    One MDBList request.

    Returns ``(state, data)``: ``(_OK, dict)`` with the answer, ``(_UNKNOWN,
    None)`` when MDBList has no such title under this endpoint, and
    ``(_NO_ANSWER, None)`` when the question did not get through - a refused
    key, an exhausted budget, a network error. Only the last case leaves the
    title marked for a retry; the reason is logged either way, so a wrong key or
    a spent budget is visible instead of silently looking like a title without
    ratings.
    """
    _throttle()

    try:
        response = requests.get(url, params={'apikey': mdblist_api_key},
                                timeout=MDBLIST_TIMEOUT)
    except requests.exceptions.Timeout:
        print(f"  [MDBList] API timeout for {url}")
        return _NO_ANSWER, None
    except requests.exceptions.RequestException as e:
        print(f"  [MDBList] API request error for {url}: {e}")
        return _NO_ANSWER, None

    if response.status_code in (401, 403):
        print("  [MDBList] API key rejected - check MDBLIST_API_KEY")
        return _NO_ANSWER, None
    if response.status_code == 404:
        # This endpoint has no such title - the other media type still may.
        return _UNKNOWN, None
    if response.status_code == 429:
        _remember_limit()
        print("  [MDBList] Rate limit reached - ratings are retried later")
        return _NO_ANSWER, None
    if response.status_code != 200:
        print(f"  [MDBList] API error: HTTP {response.status_code} for {url}")
        return _NO_ANSWER, None

    try:
        data = response.json()
    except ValueError:
        print(f"  [MDBList] API returned no JSON for {url}")
        return _NO_ANSWER, None

    if not isinstance(data, dict):
        print(f"  [MDBList] API returned no object for {url}")
        return _NO_ANSWER, None

    # A title MDBList does not know, a refused key and a spent budget all come
    # back as a normal 200 carrying an error, not as their own status code.
    error = data.get('error')
    if data.get('response') is False or error:
        message = str(error or 'unknown title')
        if any(marker in message.lower() for marker in _LIMIT_ERRORS):
            _remember_limit()
            print(f"  [MDBList] {message} - ratings are retried later")
            return _NO_ANSWER, None
        return _UNKNOWN, None

    return _OK, data


def _throttle():
    """Keep at least ``_MIN_REQUEST_INTERVAL`` between two MDBList requests."""
    global _last_request_at
    with _throttle_lock:
        wait = _MIN_REQUEST_INTERVAL - (time.monotonic() - _last_request_at)
        if wait > 0:
            time.sleep(wait)
        _last_request_at = time.monotonic()


def _remember_limit():
    """Stop asking MDBList for a while after it refused for being asked too much."""
    global _limit_until
    with _limit_lock:
        _limit_until = time.monotonic() + _LIMIT_COOLDOWN


def _limit_is_active():
    """True while MDBList is still being left alone after a refused request."""
    with _limit_lock:
        return time.monotonic() < _limit_until


def _parse_ratings(raw_ratings):
    """The rating fields of one title, read out of MDBList's ratings list."""
    ratings = _collect_ratings(raw_ratings)
    return {
        'imdb_rating': _rating_10(_first(ratings, _IMDB_SOURCES)),
        'imdb_votes': _votes(_first(ratings, _IMDB_SOURCES)),
        'rt_rating': _percent(_first(ratings, _RT_SOURCES)),
        'rt_audience': _percent(_first(ratings, _RT_AUDIENCE_SOURCES)),
        'trakt_rating': _percent(_first(ratings, _TRAKT_SOURCES)),
        'metacritic': _percent(_first(ratings, _METACRITIC_SOURCES)),
    }


def _collect_ratings(raw_ratings):
    """Turn MDBList's ratings list into a ``{source: entry}`` mapping."""
    collected = {}
    for entry in raw_ratings or []:
        if not isinstance(entry, dict):
            continue
        source = str(entry.get('source') or '').strip().lower()
        # The first entry of a source wins; MDBList lists each one once, and a
        # duplicate would only ever be the same score again.
        if source and source not in collected:
            collected[source] = entry
    return collected


def _first(ratings, sources):
    """The entry of the first source that is present, or None."""
    for source in sources:
        entry = ratings.get(source)
        if entry is not None:
            return entry
    return None


def _value(entry):
    """
    The score of one rating entry.

    MDBList reports both the source's own scale in ``value`` and a normalized
    0-100 ``score``; ``value`` is what the source itself shows, so it is
    preferred and ``score`` only fills in when it is missing.
    """
    if not isinstance(entry, dict):
        return None
    for key in ('value', 'score'):
        raw = entry.get(key)
        if raw is None:
            continue
        try:
            return float(raw)
        except (TypeError, ValueError):
            continue
    return None


def _rating_10(entry):
    """A 0-10 user rating (IMDb), or None when the title has none."""
    value = _value(entry)
    if value is None:
        return None
    return value if 0 < value <= 10 else None


def _percent(entry):
    """A percentage-style score (tomatometer, audience, Trakt, Metascore)."""
    value = _value(entry)
    if value is None:
        return None
    if not 0 <= value <= 100:
        return None
    return int(round(value))


def _votes(entry):
    """The vote count of a rating entry, or None when it carries none."""
    if not isinstance(entry, dict):
        return None
    try:
        return int(entry.get('votes'))
    except (TypeError, ValueError):
        return None
