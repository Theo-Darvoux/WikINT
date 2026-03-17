import asyncio
import json
import uuid
from collections.abc import AsyncGenerator, Callable

_user_queues: dict[uuid.UUID, list[asyncio.Queue[dict]]] = {}
_topic_queues: dict[str, list[asyncio.Queue[dict]]] = {}


# --- User-keyed queues (1:N mapping, used for notifications) ---


def register_user_queue(user_id: uuid.UUID) -> asyncio.Queue[dict]:
    """Register an SSE queue for a user. Supports multiple concurrent connections."""
    q: asyncio.Queue[dict] = asyncio.Queue()
    _user_queues.setdefault(user_id, []).append(q)
    return q


def unregister_user_queue(user_id: uuid.UUID, q: asyncio.Queue[dict]) -> None:
    """Unregister a specific SSE queue for a user."""
    queues = _user_queues.get(user_id, [])
    try:
        queues.remove(q)
    except ValueError:
        pass
    if not queues:
        _user_queues.pop(user_id, None)


def broadcast_to_user(user_id: uuid.UUID, event: dict) -> None:
    """Broadcast an event to all active SSE connections for a user."""
    for q in list(_user_queues.get(user_id, [])):
        q.put_nowait(event)


# --- Topic-keyed queues (1:N mapping, used for material annotations) ---


def register_topic_queue(topic: str) -> asyncio.Queue[dict]:
    """Register a watcher queue for a topic (e.g. a material_id)."""
    q: asyncio.Queue[dict] = asyncio.Queue()
    _topic_queues.setdefault(topic, []).append(q)
    return q


def unregister_topic_queue(topic: str, q: asyncio.Queue[dict]) -> None:
    queues = _topic_queues.get(topic, [])
    try:
        queues.remove(q)
    except ValueError:
        pass
    if not queues:
        _topic_queues.pop(topic, None)


def broadcast_to_topic(topic: str, event: dict) -> None:
    for q in list(_topic_queues.get(topic, [])):
        q.put_nowait(event)


# --- Reusable SSE event generator ---


async def sse_event_stream(
    queue: asyncio.Queue[dict],
    cleanup: Callable[[], None],
    event_name: str | None = None,
    keepalive_seconds: float = 30.0,
) -> AsyncGenerator[dict, None]:
    """
    Generic SSE event generator.

    Args:
        queue: The asyncio.Queue to read events from.
        cleanup: Called in ``finally`` to unregister the queue.
        event_name: If set, all events use this fixed name.
                    If None, the name is read from ``event["type"]``.
        keepalive_seconds: Interval for keepalive pings.
    """
    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=keepalive_seconds)
                if event.get("type") == "close":
                    break
                yield {
                    "event": event_name or event.get("type", "message"),
                    "data": json.dumps(event),
                }
            except TimeoutError:
                yield {"event": "ping", "data": ""}
    finally:
        cleanup()
