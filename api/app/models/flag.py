from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin

if TYPE_CHECKING:
    from app.models.user import User


class FlagStatus(enum.StrEnum):
    OPEN = "open"
    REVIEWING = "reviewing"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


class Flag(UUIDMixin, Base):
    __tablename__ = "flags"
    __table_args__ = (
        UniqueConstraint("reporter_id", "target_type", "target_id", name="uq_flag_reporter_target"),
        Index("idx_flags_status", "status"),
        Index("idx_flags_target", "target_type", "target_id"),
    )

    reporter_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    reason: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[FlagStatus] = mapped_column(
        Enum(FlagStatus, values_callable=lambda e: [m.value for m in e]),
        default=FlagStatus.OPEN,
        server_default="open",
    )
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    reporter: Mapped[User | None] = relationship(foreign_keys=[reporter_id])  # noqa: F821
    resolver: Mapped[User | None] = relationship(foreign_keys=[resolved_by])  # noqa: F821
