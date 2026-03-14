from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ErrorResponse(BaseModel):
    detail: str


class PaginatedResponse(BaseModel, Generic[T]):  # noqa: UP046
    items: list[T]
    total: int
    page: int
    pages: int


class HealthResponse(BaseModel):
    status: str
