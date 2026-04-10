from fastapi import Query


class PaginationParams:
    def __init__(
        self,
        page: int = Query(1, ge=1),
        limit: int = Query(20, ge=1, le=1000),
    ):
        self.page = page
        self.limit = limit
        self.offset = (page - 1) * limit
