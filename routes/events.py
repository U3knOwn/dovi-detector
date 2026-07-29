# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
The Server-Sent Events stream the page listens on.

The stream itself lives in core/sse.py, so the page and the API deliver the same
events in the same format; this endpoint is only the one the page reaches
without a token.
"""
from flask import Blueprint

from core.sse import sse_response

bp = Blueprint('events', __name__)


@bp.route('/events')
def events():
    """Server-Sent Events endpoint for real-time updates"""
    return sse_response()
