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
from services.mdblist_service import get_mdblist_ratings

# Every rating field an entry can carry. Written in full even when a title has
# no such rating, so "asked and there is none" is stored as None and is not
# mistaken for "never asked" (which would be retried forever).
RATING_FIELDS = (
    'imdb_rating', 'imdb_votes', 'rt_rating', 'rt_audience', 'trakt_rating',
    'metacritic',
)

# The key whose presence marks an entry as already looked up. It is the newest
# of the fields, so an entry from an older version - which has 'rt_rating' but
# no audience score - is queried once more and gains the new ratings without a
# rescan.
RATINGS_QUERIED_KEY = 'rt_audience'


def get_ratings(imdb_id, mdblist_api_key):
    """
    Every rating for an IMDb id.

    Returns the full set of ``RATING_FIELDS`` (None where the title has no such
    rating), or None when the lookup produced no answer at all, which is what
    tells the caller to try again later rather than to store an empty result.
    """
    ratings = get_mdblist_ratings(imdb_id, mdblist_api_key)
    if ratings is None:
        return None
    return complete_ratings(ratings)


def complete_ratings(ratings):
    """The given ratings with every missing field filled in as None."""
    return {field: ratings.get(field) for field in RATING_FIELDS}
