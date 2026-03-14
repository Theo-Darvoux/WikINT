import uuid
from datetime import datetime

from pydantic import BaseModel


class NotificationOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    type: str
    title: str
    body: str | None
    link: str | None
    read: bool
    created_at: datetime

    model_config = {"from_attributes": True}
