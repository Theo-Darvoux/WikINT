import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin


class UserRole(enum.StrEnum):
    STUDENT = "student"
    MEMBER = "member"
    BUREAU = "bureau"
    VIEUX = "vieux"


class User(UUIDMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(100))
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, values_callable=lambda e: [m.value for m in e]),
        default=UserRole.STUDENT,
        server_default="student",
    )
    bio: Mapped[str | None] = mapped_column(Text)
    academic_year: Mapped[str | None] = mapped_column(String(10))
    gdpr_consent: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    gdpr_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    onboarded: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    pull_requests: Mapped[list["PullRequest"]] = relationship(  # noqa: F821
        back_populates="author",
        foreign_keys="PullRequest.author_id",
    )
    annotations: Mapped[list["Annotation"]] = relationship(back_populates="author")  # noqa: F821
    comments: Mapped[list["Comment"]] = relationship(back_populates="author")  # noqa: F821
    notifications: Mapped[list["Notification"]] = relationship(  # noqa: F821
        back_populates="user", cascade="all, delete-orphan"
    )
