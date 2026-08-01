# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
IMDb Integration Service

Provides the IMDb Top 250 rank the poster badge shows, derived from IMDb's
public Top 250 chart, and the id check the other services validate an IMDb id
with. The ratings themselves come from MDBList (see
services/mdblist_service.py).

The chart is optional: a failing download simply means no Top 250 badge, and it
never aborts a scan.
"""
import json
import os
import re
import threading
import time

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

IMDB_ID_PATTERN = re.compile(r'^tt\d{7,}$')

# IMDb serves the chart to browsers only; a plain requests User-Agent gets a
# 403. This is the identical header set a normal desktop browser sends.
_BROWSER_HEADERS = {
    'User-Agent': ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                   'AppleWebKit/537.36 (KHTML, like Gecko) '
                   'Chrome/125.0.0.0 Safari/537.36'),
    'Accept-Language': 'en-US,en;q=0.9',
}

# IMDb's own GraphQL API - the source the Top 250 chart page itself renders
# from. It answers server-side requests, whereas www.imdb.com/chart/top hands
# out a JavaScript challenge (HTTP 202, empty body) to anything that does not
# look like a real browser, so the chart page is only a fallback here.
#
# The API sits behind a WAF that answers 403 to anything it does not recognise
# as the IMDb web client - notably a browser User-Agent on its own is rejected,
# so these client headers are what the request actually needs.
IMDB_GRAPHQL_URL = 'https://api.graphql.imdb.com/'
IMDB_GRAPHQL_HEADERS = {
    'Content-Type': 'application/json',
    'x-imdb-client-name': 'imdb-web-next',
    'x-imdb-user-country': 'US',
    'x-imdb-user-language': 'en-US',
}
IMDB_TOP250_QUERY = (
    'query{titleChartRankings(first:250,input:{rankingsChartType:TOP_250})'
    '{edges{node{item{id}}}}}'
)
IMDB_TOP250_URL = 'https://www.imdb.com/chart/top/'

# In-process cache of the Top 250 map, guarded because a bulk scan may probe
# files from several worker threads at once and would otherwise download the
# chart repeatedly.
_top250_lock = threading.Lock()
_top250_map = None
_top250_loaded_at = 0.0


def is_valid_imdb_id(imdb_id):
    """True for a well-formed IMDb title id such as 'tt0111161'."""
    return bool(imdb_id) and bool(IMDB_ID_PATTERN.match(str(imdb_id).strip()))


def _parse_top250(html):
    """
    Extract the ordered list of IMDb ids from the Top 250 chart page.

    The page markup changes regularly, so rather than depending on one
    specific structure the ids are read in document order and de-duplicated,
    which is the ranking order the page renders in. This is a best-effort
    fallback only - a list that does not come back complete is discarded by
    the caller rather than used with guessed ranks.
    """
    ids = []
    seen = set()
    for match in re.finditer(r'/title/(tt\d{7,})/', html):
        imdb_id = match.group(1)
        if imdb_id not in seen:
            seen.add(imdb_id)
            ids.append(imdb_id)
        if len(ids) >= 250:
            break
    return ids


def _read_top250_cache(cache_file, ttl_seconds):
    """Return the cached id list if the cache file exists and is fresh."""
    try:
        if not cache_file or not os.path.exists(cache_file):
            return None
        if time.time() - os.path.getmtime(cache_file) > ttl_seconds:
            return None
        with open(cache_file, 'r') as f:
            data = json.load(f)
        ids = data.get('ids') or []
        return ids if ids else None
    except Exception as e:
        print(f"  [IMDb] Could not read Top 250 cache: {e}")
        return None


def _write_top250_cache(cache_file, ids):
    """Persist the id list so a container restart does not refetch the chart."""
    try:
        if not cache_file:
            return
        os.makedirs(os.path.dirname(cache_file), exist_ok=True)
        with open(cache_file, 'w') as f:
            json.dump({'fetched_at': time.time(), 'ids': ids}, f)
    except Exception as e:
        print(f"  [IMDb] Could not write Top 250 cache: {e}")


def _fetch_top250_graphql():
    """
    Fetch the Top 250 from IMDb's GraphQL API.

    The chart comes back already ordered, so the position in the result is the
    rank. Returns a list of ids (empty on any failure).
    """
    if not REQUESTS_AVAILABLE:
        return []
    try:
        response = requests.post(
            IMDB_GRAPHQL_URL,
            json={'query': IMDB_TOP250_QUERY},
            headers=IMDB_GRAPHQL_HEADERS,
            timeout=20)
        if response.status_code != 200:
            print(f"  [IMDb] Top 250 GraphQL request failed: HTTP {response.status_code}")
            return []

        payload = response.json()
        if payload.get('errors'):
            print(f"  [IMDb] Top 250 GraphQL error: {payload['errors'][0].get('message')}")
            return []

        edges = (payload.get('data') or {}).get('titleChartRankings', {}).get('edges') or []
        ids = []
        for edge in edges:
            imdb_id = (((edge or {}).get('node') or {}).get('item') or {}).get('id')
            if is_valid_imdb_id(imdb_id):
                ids.append(imdb_id)
        return ids
    except requests.exceptions.Timeout:
        print("  [IMDb] Top 250 GraphQL request timed out")
    except requests.exceptions.RequestException as e:
        print(f"  [IMDb] Top 250 GraphQL request error: {e}")
    except Exception as e:
        print(f"  [IMDb] Error fetching Top 250 via GraphQL: {e}")
    return []


def _fetch_top250_html():
    """Fallback: parse the ids out of the public Top 250 chart page."""
    if not REQUESTS_AVAILABLE:
        return []
    try:
        response = requests.get(IMDB_TOP250_URL, headers=_BROWSER_HEADERS, timeout=15)
        if response.status_code != 200:
            print(f"  [IMDb] Top 250 request failed: HTTP {response.status_code}")
            return []
        return _parse_top250(response.text)
    except requests.exceptions.Timeout:
        print("  [IMDb] Top 250 request timed out")
    except requests.exceptions.RequestException as e:
        print(f"  [IMDb] Top 250 request error: {e}")
    except Exception as e:
        print(f"  [IMDb] Error fetching Top 250: {e}")
    return []


def _fetch_top250():
    """
    Obtain the ordered Top 250 id list, GraphQL first, chart page second.

    A short list is discarded rather than used: ranks are derived from the
    position, so a truncated download would label films with wrong numbers.
    """
    for fetch in (_fetch_top250_graphql, _fetch_top250_html):
        ids = fetch()
        if len(ids) >= 250:
            return ids[:250]
        if ids:
            print(f"  [IMDb] Discarding partial Top 250 list ({len(ids)} titles)")
    return []


def load_top250(cache_file, ttl_seconds, force=False):
    """
    Make the Top 250 map available, using the on-disk cache when it is fresh.

    Returns the ``{imdb_id: rank}`` mapping (empty when the chart could not be
    obtained). Safe to call from several scan workers - the download happens
    at most once per TTL.
    """
    global _top250_map, _top250_loaded_at

    with _top250_lock:
        fresh = (_top250_map is not None
                 and time.time() - _top250_loaded_at <= ttl_seconds)
        if fresh and not force:
            return _top250_map

        ids = None if force else _read_top250_cache(cache_file, ttl_seconds)
        if ids is None:
            ids = _fetch_top250()
            if ids:
                _write_top250_cache(cache_file, ids)

        if ids:
            _top250_map = {imdb_id: rank for rank, imdb_id in enumerate(ids, start=1)}
            _top250_loaded_at = time.time()
            print(f"✓ IMDb Top 250 list loaded ({len(_top250_map)} titles)")
        elif _top250_map is None:
            # Remember the failure as an empty map so every scanned file does
            # not trigger another download attempt.
            _top250_map = {}
            _top250_loaded_at = time.time()

        return _top250_map


def get_top250_rank(imdb_id, cache_file, ttl_seconds):
    """Return the IMDb Top 250 rank (1-250) for an id, or None if not listed."""
    if not is_valid_imdb_id(imdb_id):
        return None
    return load_top250(cache_file, ttl_seconds).get(str(imdb_id).strip())


def backfill_imdb_data(scanned_files, scan_lock, save_database_func,
                       get_imdb_id_func, get_ratings_func, top250_map,
                       ratings_queried_key='ratings_source'):
    """
    Add IMDb data and the external ratings to entries scanned before they were
    collected, and refresh the Top 250 ranks of all entries.

    Without this, an existing library would keep showing TMDB ratings until
    every file is rescanned. The IMDb id and the ratings are only looked up
    where they are missing (one request each, once per answered lookup); the
    rank comes from the already-loaded chart map and is therefore refreshed for
    every entry on every start - it changes as the chart does.
    """
    resolved = 0
    rated = 0
    rank_changed = 0

    with scan_lock:
        entries = list(scanned_files.values())

    for file_info in entries:
        tmdb_id = file_info.get('tmdb_id')
        imdb_id = file_info.get('imdb_id')

        # 'imdb_id' missing entirely means the entry predates this feature;
        # a stored None means it was looked up and has no IMDb counterpart.
        if not imdb_id and 'imdb_id' not in file_info and tmdb_id and get_imdb_id_func:
            imdb_id = get_imdb_id_func(tmdb_id, 'movie') or get_imdb_id_func(tmdb_id, 'tv')
            file_info['imdb_id'] = imdb_id
            if imdb_id:
                resolved += 1

        if not imdb_id:
            continue

        # The marker key tells an entry that was already queried apart from one
        # that never was, so a title that genuinely has no ratings is not
        # re-requested daily. It is written only for a lookup that answered, so
        # entries from an older version - and entries whose lookup failed
        # because the key was missing or MDBList was unreachable - are looked up
        # once more and gain their ratings without a rescan.
        if ratings_queried_key not in file_info and get_ratings_func:
            ratings = get_ratings_func(imdb_id)
            if ratings is not None:
                file_info.update(ratings)
                rated += 1

        new_rank = (top250_map or {}).get(imdb_id)
        if file_info.get('imdb_top250') != new_rank:
            file_info['imdb_top250'] = new_rank
            rank_changed += 1

    if resolved or rated or rank_changed:
        with scan_lock:
            save_database_func()
        print(f"✓ IMDb data updated - {resolved} ID(s), {rated} rating(s), "
              f"{rank_changed} Top 250 rank(s)")
