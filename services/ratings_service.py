# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Where the ratings of a title come from.

MDBList is the source: one request per title returns the IMDb rating, both
Rotten Tomatoes scores (tomatometer and audience), Trakt and Metacritic. This
module is what the rest of the application asks, so the provider stays in one
place and every entry ends up with the same set of keys (see ``RATING_FIELDS``)
- an entry never carries half a set.
"""
from services.mdblist_service import get_mdblist_ratings, verify_mdblist_key

# What ``ratings_source`` holds once a lookup has answered for an entry.
RATINGS_SOURCE = 'mdblist'

# Every rating value an entry can carry. Written in full even when a title has
# no such rating, so "asked and there is none" is stored as None and is not
# mistaken for "never asked" (which would be retried forever).
RATING_FIELDS = (
    'imdb_rating', 'imdb_votes', 'rt_rating', 'rt_audience', 'trakt_rating',
    'metacritic',
)

# The key whose presence marks an entry as already looked up. It is written only
# when a lookup actually answered, so a failed request - an unreachable API, a
# spent daily budget, a key that was added afterwards - leaves the entry marked
# as "never asked" and it is looked up again. A rating field cannot serve as
# that marker: it is None both for a title without that rating and for a request
# that never got through.
RATINGS_QUERIED_KEY = 'ratings_source'


def get_ratings(imdb_id, mdblist_api_key, media_type=None):
    """
    Every rating for an IMDb id.

    Returns the full set of ``RATING_FIELDS`` (None where the title has no such
    rating), or None when the lookup produced no answer at all, which is what
    tells the caller to try again later rather than to store an empty result.

    ``media_type`` ('movie' or 'tv') spares MDBList the wrong guess when the
    caller already knows which one the title is.
    """
    ratings = get_mdblist_ratings(imdb_id, mdblist_api_key, media_type)
    if ratings is None:
        return None
    return complete_ratings(ratings)


def complete_ratings(ratings):
    """
    The given ratings with every missing field filled in as None.

    For a lookup that answered, so the entry is stamped with the source it
    answered from - that stamp is what keeps it from being asked again.
    """
    completed = {field: ratings.get(field) for field in RATING_FIELDS}
    completed[RATINGS_QUERIED_KEY] = RATINGS_SOURCE
    return completed


def empty_ratings():
    """
    The rating fields of a title there is nothing to ask for - one without an
    IMDb id.

    Carries no source stamp: nothing answered, and claiming otherwise would keep
    the entry from ever being asked should it gain an IMDb id later.
    """
    return {field: None for field in RATING_FIELDS}


def verify_ratings_key(mdblist_api_key):
    """Check the configured key once and log whether MDBList accepts it."""
    return verify_mdblist_key(mdblist_api_key)
