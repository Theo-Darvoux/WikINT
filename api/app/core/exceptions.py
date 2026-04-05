from fastapi import HTTPException, status


class AppError(HTTPException):
    def __init__(self, status_code: int, detail: str, code: str | None = None):
        super().__init__(status_code=status_code, detail=detail)
        self.code = code


class NotFoundError(AppError):
    def __init__(self, detail: str = "Resource not found", code: str | None = None):
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail, code=code)


class BadRequestError(AppError):
    def __init__(self, detail: str = "Bad request", code: str | None = None):
        super().__init__(status_code=status.HTTP_400_BAD_REQUEST, detail=detail, code=code)


class UnauthorizedError(AppError):
    def __init__(self, detail: str = "Not authenticated", code: str | None = None):
        super().__init__(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail, code=code)


class ForbiddenError(AppError):
    def __init__(self, detail: str = "Not enough permissions", code: str | None = None):
        super().__init__(status_code=status.HTTP_403_FORBIDDEN, detail=detail, code=code)


class ConflictError(AppError):
    def __init__(self, detail: str = "Conflict", code: str | None = None):
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=detail, code=code)


class RateLimitError(AppError):
    def __init__(self, detail: str = "Too many requests", code: str | None = None):
        super().__init__(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=detail, code=code)


class ServiceUnavailableError(AppError):
    def __init__(self, detail: str = "Service unavailable", code: str | None = None):
        super().__init__(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail, code=code)
