import asyncio
import json
import os
import sys
import uuid

# Add api directory to sys.path
sys.path.append(os.path.join(os.getcwd(), "api"))

from app.core.sse import (
    broadcast_to_user,
    register_user_queue,
    sse_event_stream,
    unregister_user_queue,
)


async def simulate_worker(worker_id, user_id, results):
    print(f"Worker {worker_id} started listening for user {user_id}")
    q = register_user_queue(user_id)
    stream = sse_event_stream(
        q, lambda: unregister_user_queue(user_id, q), event_name="notification"
    )

    try:
        async for event in stream:
            if event["event"] == "ping":
                continue
            print(f"Worker {worker_id} received event: {event}")
            results.append((worker_id, event))
            if "close" in event["data"]:
                break
            # For testing, we just want one notification
            if "test_id" in event["data"]:
                break
    except Exception as e:
        print(f"Worker {worker_id} error: {e}")


async def test_sse_broadcast():
    user_id = uuid.uuid4()
    results = []

    # Start 3 "workers" listening for the same user
    workers = [asyncio.create_task(simulate_worker(i, user_id, results)) for i in range(3)]

    # Wait a bit for subscription to complete
    await asyncio.sleep(1)

    print("Broadcasting notification...")
    test_event = {"type": "notification", "id": "test_id", "title": "Test Notification"}
    broadcast_to_user(user_id, test_event)

    # Wait for workers to receive
    try:
        await asyncio.wait_for(asyncio.gather(*workers), timeout=5)
    except TimeoutError:
        print("Test timed out!")

    print(f"Total events received: {len(results)}")
    for wid, event in results:
        data = json.loads(event["data"])
        assert data["id"] == "test_id"
        print(f"Validated event for worker {wid}")

    if len(results) == 3:
        print("SUCCESS: All workers received the broadcast.")
    else:
        print(f"FAILURE: Only {len(results)} workers received the broadcast.")


if __name__ == "__main__":
    asyncio.run(test_sse_broadcast())
