from __future__ import annotations

import enum
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.material import Material
    from app.models.tag import Tag


class DirectoryType(enum.StrEnum):
    MODULE = "module"
    FOLDER = "folder"


class Directory(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "directories"
    __table_args__ = (UniqueConstraint("parent_id", "slug", name="uq_directory_parent_slug"),)

    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("directories.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[DirectoryType] = mapped_column(
        Enum(DirectoryType, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    description: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict[str, object]] = mapped_column(
        "metadata", JSONB, default=dict, server_default="{}"
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    parent: Mapped[Directory | None] = relationship(
        back_populates="children", remote_side="Directory.id"
    )
    children: Mapped[list[Directory]] = relationship(
        back_populates="parent", cascade="all, delete-orphan"
    )
    materials: Mapped[list[Material]] = relationship(
        back_populates="directory", cascade="all, delete-orphan"
    )
    tags: Mapped[list[Tag]] = relationship(secondary="directory_tags", back_populates="directories")
