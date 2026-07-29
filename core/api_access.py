# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Who may call the versioned API, and from where.

Two independent gates:

* the token - every request has to carry ``API_TOKEN``. Without a configured
  token the API stays switched off entirely rather than open, because it can
  start scans and empty the database.
* the origin - a browser on another site may only read the answers when its
  origin is listed in ``API_CORS_ORIGINS``. This says nothing about curl or a
  server-side caller; those are never subject to CORS.
"""
import hmac

from flask import Response, jsonify, request

import config

# Headers a caller may put the token in. The query parameter exists because
# EventSource (the browser's SSE client) cannot send headers at all.
TOKEN_HEADER = 'X-API-Token'
TOKEN_QUERY_PARAM = 'token'

# Headers a browser is allowed to send on a cross-origin API request
ALLOWED_REQUEST_HEADERS = f'Authorization, Content-Type, {TOKEN_HEADER}'
ALLOWED_METHODS = 'GET, POST, OPTIONS'
PREFLIGHT_MAX_AGE = '600'


def api_enabled():
    """True once a token is configured - without one the API is off."""
    return bool(config.API_TOKEN)


def presented_token():
    """The token the current request carries, from wherever it put it."""
    header = request.headers.get('Authorization', '')
    if header.startswith('Bearer '):
        return header[len('Bearer '):].strip()

    from_header = request.headers.get(TOKEN_HEADER)
    if from_header:
        return from_header.strip()

    return (request.args.get(TOKEN_QUERY_PARAM) or '').strip()


def token_is_valid():
    """Compare the presented token in constant time."""
    token = presented_token()
    if not token:
        return False
    # Compared as bytes: compare_digest rejects strings that are not ASCII, and
    # a token is whatever the operator put in the environment.
    return hmac.compare_digest(token.encode('utf-8'), config.API_TOKEN.encode('utf-8'))


def authorization_error():
    """
    The response to send when a request may not pass, or None when it may.

    Kept as a returned value rather than an exception so the blueprint's
    before_request can hand it straight back.
    """
    if not api_enabled():
        return error_response(
            'api_disabled',
            'The API is disabled. Set API_TOKEN to enable it.',
            503)

    if not token_is_valid():
        response = error_response(
            'unauthorized',
            f'Provide the API token as "Authorization: Bearer <token>", '
            f'"{TOKEN_HEADER}: <token>" or "?{TOKEN_QUERY_PARAM}=<token>".',
            401)
        # Tell a generic client how to authenticate, as the status code alone
        # does not say which scheme is expected
        response.headers['WWW-Authenticate'] = 'Bearer realm="Universal Video Scanner"'
        return response

    return None


def error_response(code, message, status):
    """A failure in the same shape every API answer uses."""
    response = jsonify({'success': False, 'error': message, 'code': code})
    response.status_code = status
    return response


def allowed_origin():
    """
    The value for Access-Control-Allow-Origin, or None when this request gets
    no CORS headers at all.
    """
    origin = request.headers.get('Origin')
    if not origin or not config.API_CORS_ORIGINS:
        return None
    if '*' in config.API_CORS_ORIGINS:
        return '*'
    if origin in config.API_CORS_ORIGINS:
        return origin
    return None


def apply_cors(response):
    """Add the CORS headers to an answer, if the caller's origin is allowed."""
    origin = allowed_origin()
    if not origin:
        return response

    response.headers['Access-Control-Allow-Origin'] = origin
    response.headers['Access-Control-Expose-Headers'] = 'Content-Encoding, Content-Length'
    if origin != '*':
        # The answer differs per origin, so it must not be cached for another
        response.vary.add('Origin')
    return response


def preflight_response():
    """
    Answer a browser's OPTIONS probe.

    Deliberately before the token check: a preflight never carries credentials,
    and answering it with 401 would only hide the real error from the caller.
    """
    response = Response(status=204)
    if allowed_origin():
        response.headers['Access-Control-Allow-Methods'] = ALLOWED_METHODS
        response.headers['Access-Control-Allow-Headers'] = ALLOWED_REQUEST_HEADERS
        response.headers['Access-Control-Max-Age'] = PREFLIGHT_MAX_AGE
    return response
