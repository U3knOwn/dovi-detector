# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
IMDb Integration Service

Provides the two pieces of IMDb data the UI shows:

* the IMDb user rating, fetched from the OMDb API (the same source Kodi's
  TMDb Helper uses - it needs a free per-user API key), and
* the IMDb Top 250 rank, derived from IMDb's public Top 250 chart.

Both are optional: without an OMDb key no IMDb rating is fetched (the UI then
falls back to the TMDb rating), and a failing chart download simply means no
Top 250 badge. Neither ever aborts a scan.
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
# from. It answers plain server-side requests, whereas www.imdb.com/chart/top
# hands out a JavaScript challenge (HTTP 202, empty body) to anything that does
# not look like a real browser, so the chart page is only a fallback here.
IMDB_GRAPHQL_URL = 'https://api.graphql.imdb.com/'
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


def get_omdb_ratings(imdb_id, omdb_api_key):
    """
    Fetch all ratings OMDb knows for an IMDb id in a single request.

    Returns a dict with ``imdb_rating`` (float, 0-10), ``imdb_votes`` (int),
    ``rt_rating`` (int, Rotten Tomatoes tomatometer in percent) and
    ``metacritic`` (int, Metascore out of 100). Individual entries are None
    when that rating does not exist for the title.

    Returns None when the lookup itself failed (no key, unknown title, network
    error) - the caller uses that to tell "nothing to show" apart from "not
    asked yet" and retry later.
    """
    if not omdb_api_key or not REQUESTS_AVAILABLE:
        return None

    if not is_valid_imdb_id(imdb_id):
        print(f"  [IMDb] Invalid IMDb ID: {imdb_id}")
        return None

    try:
        response = requests.get(
            'https://www.omdbapi.com/',
            params={'apikey': omdb_api_key, 'i': str(imdb_id).strip()},
            timeout=10)

        if response.status_code != 200:
            print(f"  [IMDb] OMDb API error for {imdb_id}: HTTP {response.status_code}")
            return None

        data = response.json()
        if data.get('Response') != 'True':
            print(f"  [IMDb] OMDb returned no data for {imdb_id}: {data.get('Error')}")
            return None

        # Rotten Tomatoes only appears in the Ratings list, Metacritic both
        # there and as the top-level Metascore field.
        rt_raw = None
        for entry in data.get('Ratings') or []:
            if entry.get('Source') == 'Rotten Tomatoes':
                rt_raw = entry.get('Value')
                break

        return {
            'imdb_rating': _parse_rating(data.get('imdbRating')),
            'imdb_votes': _parse_votes(data.get('imdbVotes')),
            'rt_rating': _parse_percent(rt_raw),
            'metacritic': _parse_percent(data.get('Metascore')),
        }
    except requests.exceptions.Timeout:
        print(f"  [IMDb] OMDb API timeout for {imdb_id}")
    except requests.exceptions.RequestException as e:
        print(f"  [IMDb] OMDb API request error for {imdb_id}: {e}")
    except Exception as e:
        print(f"  [IMDb] Error fetching OMDb ratings for {imdb_id}: {e}")

    return None


def _parse_rating(raw):
    """OMDb reports the rating as a string ('8.7') or 'N/A'."""
    try:
        value = float(str(raw).strip())
    except (TypeError, ValueError):
        return None
    return value if 0 < value <= 10 else None


def _parse_votes(raw):
    """OMDb reports votes as a thousands-separated string ('2,845,123')."""
    try:
        return int(str(raw).replace(',', '').strip())
    except (TypeError, ValueError):
        return None


def _parse_percent(raw):
    """
    Parse OMDb's percentage-style ratings into a plain int.

    Covers the Rotten Tomatoes tomatometer ('97%'), the Metascore both as the
    bare field ('100') and as it appears in the Ratings list ('100/100'), and
    the 'N/A' OMDb returns for titles without that rating.
    """
    text = str(raw).strip().rstrip('%')
    if '/' in text:
        text = text.split('/')[0]
    try:
        value = int(text)
    except (TypeError, ValueError):
        return None
    return value if 0 <= value <= 100 else None


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
            headers={'Content-Type': 'application/json'},
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
                       get_imdb_id_func, get_omdb_ratings_func, top250_map):
    """
    Add IMDb/OMDb data to entries scanned before it was collected, and refresh
    the Top 250 ranks of all entries.

    Without this, an existing library would keep showing TMDB ratings until
    every file is rescanned. The IMDb id and the OMDb ratings are only looked
    up where they are missing (one request each, once); the rank comes from the
    already-loaded chart map and is therefore refreshed for every entry on
    every start - it changes as the chart does.
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

        # A stored 'rt_rating' key marks the entry as already queried, so a
        # title that genuinely has no OMDb ratings is not re-requested daily.
        if 'rt_rating' not in file_info and get_omdb_ratings_func:
            ratings = get_omdb_ratings_func(imdb_id)
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
