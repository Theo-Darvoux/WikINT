from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin
from app.models.security import VirusScanResult

if TYPE_CHECKING:
    from app.models.annotation import Annotation
    from app.models.directory import Directory
    from app.models.tag import Tag
    from app.models.user import User


class Material(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "materials"
    __table_args__ = (
        UniqueConstraint("directory_id", "slug", name="uq_material_directory_slug"),
        Index(
            "uq_material_root_slug",
            "slug",
            unique=True,
            postgresql_where=text("directory_id IS NULL"),
        ),
    )

    directory_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("directories.id", ondelete="CASCADE"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    slug: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    current_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    parent_material_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("materials.id", ondelete="CASCADE")
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    metadata_: Mapped[dict[str, object]] = mapped_column(
        "metadata", JSONB, default=dict, server_default="{}"
    )
    download_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    directory: Mapped[Directory] = relationship(back_populates="materials")
    author: Mapped[User | None] = relationship(foreign_keys=[author_id])
    versions: Mapped[list[MaterialVersion]] = relationship(
        back_populates="material",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="MaterialVersion.version_number",
    )
    parent_material: Mapped[Material | None] = relationship(
        remote_side="Material.id", foreign_keys=[parent_material_id]
    )
    tags: Mapped[list[Tag]] = relationship(secondary="material_tags", back_populates="materials")
    annotations: Mapped[list[Annotation]] = relationship(
        back_populates="material", cascade="all, delete-orphan", passive_deletes=True
    )


class MaterialVersion(UUIDMixin, Base):
    __tablename__ = "material_versions"
    __table_args__ = (
        UniqueConstraint("material_id", "version_number", name="uq_material_version"),
    )

    material_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("materials.id", ondelete="CASCADE"), nullable=False
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    file_key: Mapped[str | None] = mapped_column(String(500))
    file_name: Mapped[str | None] = mapped_column(String(300))
    file_size: Mapped[int | None] = mapped_column(BigInteger)
    file_mime_type: Mapped[str | None] = mapped_column(String(100))
    diff_summary: Mapped[str | None] = mapped_column(Text)
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    pr_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("pull_requests.id", ondelete="SET NULL")
    )
    cas_sha256: Mapped[str | None] = mapped_column(String(64))
    virus_scan_result: Mapped[VirusScanResult] = mapped_column(
        String(20),
        default=VirusScanResult.PENDING,
        server_default="pending",
    )
    # Optimistic concurrency lock — incremented on every edit.
    # PR operations may include the expected value; a mismatch means a concurrent
    # edit occurred and the PR should be rejected to prevent data loss.
    version_lock: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    material: Mapped[Material] = relationship(back_populates="versions")
