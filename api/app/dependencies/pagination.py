from fastapi import Query, Response


def set_pagination_headers(response: Response, total_count: int) -> None:
    response.headers["X-Total-Count"] = str(total_count)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"


class PaginationParams:
    def __init__(
        self,
        page: int = Query(1, ge=1),
        limit: int = Query(20, ge=1, le=1000),
    ):
        self.page = page
        self.limit = limit
        self.offset = (page - 1) * limit
