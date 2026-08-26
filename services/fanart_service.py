# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Fanart.tv API Integration Service
Handles all interactions with Fanart.tv API
"""
from urllib.parse import urlparse
from services.tmdb_service import extract_tmdb_id

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False


def is_valid_fanart_url(url):
    """Validate URL is from Fanart.tv to prevent SSRF attacks"""
    if not url:
        return False

    try:
        parsed = urlparse(url)
        # Check scheme is https
        if parsed.scheme != 'https':
            return False
        # Check hostname is exactly assets.fanart.tv
        if parsed.netloc != 'assets.fanart.tv':
            return False
        # Check path starts with /fanart/
        if not parsed.path.startswith('/fanart/'):
            return False
        return True
    except Exception:
        return False


def _thumb_likes(thumb):
    """A thumb's like count, 0 when it carries none or an unparsable one."""
    try:
        return int(thumb.get('likes', 0))
    except (ValueError, TypeError):
        return 0


def _most_liked_url(thumbs, language=None):
    """
    The URL of the most-liked thumb, restricted to one ``language`` when given.

    Returns None when no thumb matches, and also when the winner carries no URL
    at all - either way the caller moves on to its next choice.
    """
    if language is not None:
        thumbs = [t for t in thumbs if (t.get('lang') or '').lower() == language]
    if not thumbs:
        return None
    return max(thumbs, key=_thumb_likes).get('url')


def _artwork_by_id(tmdb_id, media_type, fanart_api_key, content_language, kind, label):
    """
    One kind of artwork for a TMDB id, most-liked first.

    ``kind`` is the key Fanart.tv files the images under - ``moviethumb`` for
    the 16:9 thumb the web interface shows, ``movieposter`` for the upright 2:3
    poster. The language preference is the same for both: the configured one,
    then English, then whatever is most liked regardless of language.
    """
    if not fanart_api_key or not REQUESTS_AVAILABLE:
        return None

    # Validate tmdb_id is a valid numeric string or integer
    if not tmdb_id or not isinstance(tmdb_id, (str, int)) or not str(tmdb_id).isdigit():
        print(f"Invalid TMDB ID for Fanart.tv: {tmdb_id}")
        return None

    try:
        if media_type == 'movie':
            url = f'https://webservice.fanart.tv/v3/movies/{tmdb_id}'
        else:  # TV show - Note: Fanart.tv uses TVDB ID for TV shows, not TMDB
            # For TV shows, we would need TVDB ID, which we don't have
            # So we'll return None for TV shows
            print("  [FANART] TV shows not supported (requires TVDB ID)")
            return None

        params = {'api_key': fanart_api_key}
        response = requests.get(url, params=params, timeout=10)

        if response.status_code == 200:
            images = response.json().get(kind, [])

            # The configured language first, then English, then whatever has
            # the most likes regardless of language.
            languages = ('en',) if content_language == 'en' else (content_language, 'en')
            for index, language in enumerate(languages):
                image_url = _most_liked_url(images, language)
                if image_url:
                    note = ' (fallback)' if index else ''
                    print(f"  [FANART] {label} found in {language}{note}: {image_url}")
                    return image_url

            image_url = _most_liked_url(images)
            if image_url:
                print(f"  [FANART] {label} found (any language): {image_url}")
                return image_url

        if response.status_code not in [200, 404]:
            print(
                f"Fanart.tv API error for ID {tmdb_id}: HTTP "
                f"{response.status_code}")
    except requests.exceptions.Timeout:
        print(f"Fanart.tv API timeout for ID {tmdb_id}")
    except requests.exceptions.RequestException as e:
        print(f"Fanart.tv API request error for ID {tmdb_id}: {e}")
    except Exception as e:
        print(f"Error fetching Fanart.tv {label.lower()} by ID {tmdb_id}: {e}")

    return None


def get_fanart_poster_by_id(tmdb_id, media_type, fanart_api_key, content_language):
    """Fetch the 16:9 thumb poster URL from Fanart.tv API by TMDB ID"""
    return _artwork_by_id(tmdb_id, media_type, fanart_api_key, content_language,
                          'moviethumb', 'Thumb poster')


def get_fanart_portrait_by_id(tmdb_id, media_type, fanart_api_key, content_language):
    """
    Fetch the upright 2:3 poster from Fanart.tv API by TMDB ID.

    A different image entirely from the thumb above: ``movieposter`` is the
    cover art, which is what a grid of covers on a phone wants.
    """
    return _artwork_by_id(tmdb_id, media_type, fanart_api_key, content_language,
                          'movieposter', 'Portrait poster')


def get_fanart_poster(filename, fanart_api_key, content_language):
    """Main function for Fanart.tv: Try ID first. Returns (tmdb_id, poster_url)"""
    if not fanart_api_key or not REQUESTS_AVAILABLE:
        return None, None

    # Try to extract TMDB ID first (Fanart.tv requires TMDB ID)
    tmdb_id = extract_tmdb_id(filename)
    if tmdb_id:
        print(f"  [FANART] Found TMDB ID: {tmdb_id}")
        # Try movie first
        poster_url = get_fanart_poster_by_id(tmdb_id, 'movie', fanart_api_key, content_language)
        if poster_url:
            print(f"  [FANART] Poster found by ID (movie): {poster_url}")
            return tmdb_id, poster_url
        # Note: TV shows would need TVDB ID, which we don't extract

    print(f"  [FANART] No poster found for: {filename}")
    return None, None
