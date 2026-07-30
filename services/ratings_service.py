# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Where the ratings of a title come from.

MDBList is the source: one request per title returns the IMDb rating, both
Rotten Tomatoes scores (tomatometer and audience), Trakt and Metacritic. OMDb
is kept as a fallback for installations that were set up before MDBList existed
and only carry an OMDb key - it knows neither the audience score nor Trakt, so
those simply stay empty there.

Whichever provider answers, the result always has the same shape (see
``RATING_FIELDS``), so an entry never carries half a set of keys.
"""
from services.imdb_service import get_omdb_ratings
from services.mdblist_service import get_mdblist_ratings

# Every rating field an entry can carry. Written in full even when a provider
# knows nothing about a field, so "asked and there is none" is stored as None
# and is not mistaken for "never asked" (which would be retried forever).
RATING_FIELDS = (
    'imdb_rating', 'imdb_votes', 'rt_rating', 'rt_audience', 'trakt_rating',
    'metacritic',
)

# The key whose presence marks an entry as already looked up. It is the newest
# of the fields, so an entry from an older version - which has 'rt_rating' but
# no audience score - is queried once more and gains the new ratings without a
# rescan.
RATINGS_QUERIED_KEY = 'rt_audience'


def ratings_configured(mdblist_api_key, omdb_api_key):
    """True when at least one ratings provider has a key."""
    return bool(mdblist_api_key or omdb_api_key)


def get_ratings(imdb_id, mdblist_api_key, omdb_api_key):
    """
    Every rating for an IMDb id, from MDBList or - failing that - from OMDb.

    Returns the full set of ``RATING_FIELDS`` (None where the title has no such
    rating), or None when no provider produced an answer at all, which is what
    tells the caller to try again later rather than to store an empty result.
    """
    ratings = get_mdblist_ratings(imdb_id, mdblist_api_key)
    if ratings is None:
        ratings = get_omdb_ratings(imdb_id, omdb_api_key)
    if ratings is None:
        return None
    return complete_ratings(ratings)


def complete_ratings(ratings):
    """The given ratings with every missing field filled in as None."""
    return {field: ratings.get(field) for field in RATING_FIELDS}
