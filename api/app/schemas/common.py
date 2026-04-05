from typing import TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ErrorResponse(BaseModel):
    detail: str


class PaginatedResponse[T](BaseModel):
    items: list[T]
    total: int
    page: int
    pages: int


class HealthResponse(BaseModel):
    status: str
    details: dict[str, str] | None = None
