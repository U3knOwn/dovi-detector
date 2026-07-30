# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
MDBList Integration Service

MDBList (https://api.mdblist.com/) answers with every rating a title has - IMDb,
Rotten Tomatoes tomatometer *and* audience score, Trakt and Metacritic - in a
single request, where OMDb knows neither the audience score nor Trakt. The free
tier allows 1000 requests per day, the same budget as OMDb, so one request per
title is all the ratings cost.

The key is optional: without it no MDBList lookup happens at all and the caller
falls back to OMDb (see services/ratings_service.py). A failing request never
aborts a scan.
"""
try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

from services.imdb_service import is_valid_imdb_id

MDBLIST_API_URL = 'https://api.mdblist.com/'

# One rating source can be spelled differently across MDBList's endpoints
# ('tmdb' vs. 'themoviedb', the audience score as 'tomatoesaudience' or
# 'audience'), so every accepted spelling is listed rather than assumed.
_IMDB_SOURCES = ('imdb',)
_RT_SOURCES = ('tomatoes',)
_RT_AUDIENCE_SOURCES = ('tomatoesaudience', 'audience', 'popcorn')
_TRAKT_SOURCES = ('trakt',)
_METACRITIC_SOURCES = ('metacritic',)


def get_mdblist_ratings(imdb_id, mdblist_api_key):
    """
    Fetch every rating MDBList knows for an IMDb id in a single request.

    Returns a dict with ``imdb_rating`` (float, 0-10), ``imdb_votes`` (int),
    ``rt_rating`` (int, Rotten Tomatoes tomatometer in percent), ``rt_audience``
    (int, Rotten Tomatoes audience score in percent), ``trakt_rating`` (int,
    Trakt score in percent) and ``metacritic`` (int, Metascore out of 100).
    Individual entries are None when that rating does not exist for the title.

    Returns None when the lookup itself failed (no key, unknown title, network
    error) - the caller uses that to tell "nothing to show" apart from "not
    asked yet" and to fall back to another provider.
    """
    if not mdblist_api_key or not REQUESTS_AVAILABLE:
        return None

    if not is_valid_imdb_id(imdb_id):
        print(f"  [MDBList] Invalid IMDb ID: {imdb_id}")
        return None

    imdb_id = str(imdb_id).strip()

    try:
        # The query form takes the IMDb id directly and needs no media type, so
        # a movie and a series both cost exactly one request. The path form is
        # the newer spelling of the same lookup and is only tried when the first
        # one is not served at all - an answer that says "no such title" or "key
        # rejected" is final and must not cost a second request out of the daily
        # budget.
        data = _request(MDBLIST_API_URL, {'apikey': mdblist_api_key, 'i': imdb_id})
        if data is None:
            data = _request(f'{MDBLIST_API_URL}imdb/movie/{imdb_id}',
                            {'apikey': mdblist_api_key})
        if not data:
            return None

        ratings = _collect_ratings(data.get('ratings'))
        return {
            'imdb_rating': _rating_10(ratings.get(_IMDB_SOURCES[0])),
            'imdb_votes': _votes(ratings.get(_IMDB_SOURCES[0])),
            'rt_rating': _percent(_first(ratings, _RT_SOURCES)),
            'rt_audience': _percent(_first(ratings, _RT_AUDIENCE_SOURCES)),
            'trakt_rating': _percent(_first(ratings, _TRAKT_SOURCES)),
            'metacritic': _percent(_first(ratings, _METACRITIC_SOURCES)),
        }
    except requests.exceptions.Timeout:
        print(f"  [MDBList] API timeout for {imdb_id}")
    except requests.exceptions.RequestException as e:
        print(f"  [MDBList] API request error for {imdb_id}: {e}")
    except Exception as e:
        print(f"  [MDBList] Error fetching ratings for {imdb_id}: {e}")

    return None


def _request(url, params):
    """
    One MDBList request.

    Returns the answer as a dict, ``False`` when the API answered but has
    nothing to give (unknown title, rejected key, rate limit) and ``None`` when
    this endpoint could not be asked at all - only the last case is worth
    retrying on the other endpoint, the other two are final and must not cost a
    second request. A rejected key and a spent daily budget are reported so the
    cause is visible in the log instead of silently looking like a title
    without ratings.
    """
    response = requests.get(url, params=params, timeout=10)

    if response.status_code in (401, 403):
        print("  [MDBList] API key rejected - check MDBLIST_API_KEY")
        return False
    if response.status_code == 429:
        print("  [MDBList] Rate limit reached - ratings are retried later")
        return False
    if response.status_code != 200:
        print(f"  [MDBList] API error: HTTP {response.status_code}")
        return None

    try:
        data = response.json()
    except ValueError:
        print("  [MDBList] API returned no JSON")
        return None

    if not isinstance(data, dict):
        return None

    # A title MDBList does not know comes back as a normal 200 carrying an
    # error, not as a 404.
    if data.get('response') is False or data.get('error'):
        print(f"  [MDBList] No data: {data.get('error') or 'unknown title'}")
        return False

    return data


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
