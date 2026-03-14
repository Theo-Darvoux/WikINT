from sqlalchemy import Column, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin

material_tags = Table(
    "material_tags",
    Base.metadata,
    Column("material_id", ForeignKey("materials.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)

directory_tags = Table(
    "directory_tags",
    Base.metadata,
    Column("directory_id", ForeignKey("directories.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class Tag(UUIDMixin, Base):
    __tablename__ = "tags"

    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    category: Mapped[str | None] = mapped_column(String(50))

    materials: Mapped[list["Material"]] = relationship(  # noqa: F821
        secondary=material_tags, back_populates="tags"
    )
    directories: Mapped[list["Directory"]] = relationship(  # noqa: F821
        secondary=directory_tags, back_populates="tags"
    )
