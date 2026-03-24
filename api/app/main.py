import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.responses import JSONResponse

from app.config import settings
from app.schemas.common import HealthResponse

logger = logging.getLogger("wikint")

limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=settings.redis_url,
    default_limits=["60/minute"],
    enabled=not settings.is_dev,
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info("WikINT API starting up")

    from app.core.meilisearch import setup_meilisearch
    from app.core.redis import close_arq_pool, init_arq_pool
    from app.core.storage import close_s3_client, init_s3_client

    try:
        await setup_meilisearch()
        await init_arq_pool()
        await init_s3_client()
    except Exception as e:
        logger.error(f"Failed to setup search or storage: {e}")

    yield
    logger.info("WikINT API shutting down")
    await close_arq_pool()
    await close_s3_client()
    from app.core.redis import redis_client

    await redis_client.aclose()


app = FastAPI(
    title="WikINT API",
    description="Course materials platform for Telecom SudParis / IMT-BS",
    version="0.1.0",
    docs_url="/api/docs" if settings.is_dev else None,
    openapi_url="/api/openapi.json" if settings.is_dev else None,
    lifespan=lifespan,
)

app.state.limiter = limiter


async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests"},
    )


app.add_exception_handler(RateLimitExceeded, rate_limit_handler)  # type: ignore[arg-type]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=settings.cors_headers_list,
)


@app.middleware("http")
async def log_requests(request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
    start = time.perf_counter()
    response: Response = await call_next(request)
    elapsed = time.perf_counter() - start
    logger.info(
        "%s %s %d %.3fs",
        request.method,
        request.url.path,
        response.status_code,
        elapsed,
    )
    return response


@app.get("/api/health", response_model=HealthResponse, tags=["health"])
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


from app.routers.admin import router as admin_router  # noqa: E402
from app.routers.annotations import (  # noqa: E402
    annotations_router,
    material_annotations_router,
)
from app.routers.auth import router as auth_router  # noqa: E402
from app.routers.browse import router as browse_router  # noqa: E402
from app.routers.comments import router as comments_router  # noqa: E402
from app.routers.directories import router as directories_router  # noqa: E402
from app.routers.flags import router as flags_router  # noqa: E402
from app.routers.materials import router as materials_router  # noqa: E402
from app.routers.notifications import router as notifications_router  # noqa: E402
from app.routers.onlyoffice import router as onlyoffice_router  # noqa: E402
from app.routers.pr_comments import router as pr_comments_router  # noqa: E402
from app.routers.pull_requests import router as pull_requests_router  # noqa: E402
from app.routers.search import router as search_router  # noqa: E402
from app.routers.upload import router as upload_router  # noqa: E402
from app.routers.users import router as users_router  # noqa: E402

app.include_router(admin_router)
app.include_router(annotations_router)
app.include_router(auth_router)
app.include_router(browse_router)
app.include_router(comments_router)
app.include_router(directories_router)
app.include_router(flags_router)
app.include_router(material_annotations_router)
app.include_router(materials_router)
app.include_router(notifications_router)
app.include_router(pr_comments_router)
app.include_router(pull_requests_router)
app.include_router(search_router)
app.include_router(onlyoffice_router)
app.include_router(upload_router)
app.include_router(users_router)

if settings.is_dev:
    try:
        from sqladmin import Admin, ModelView

        from app.core.database import engine

        admin = Admin(app, engine)

        from app.models.annotation import Annotation
        from app.models.comment import Comment
        from app.models.directory import Directory
        from app.models.flag import Flag
        from app.models.material import Material, MaterialVersion
        from app.models.notification import Notification
        from app.models.pull_request import PRComment, PRVote, PullRequest
        from app.models.tag import Tag
        from app.models.user import User
        from app.models.view_history import ViewHistory

        class UserAdmin(ModelView, model=User):
            column_list = [User.id, User.email, User.display_name, User.role, User.onboarded]

        class DirectoryAdmin(ModelView, model=Directory):
            column_list = [Directory.id, Directory.name, Directory.slug, Directory.type]

        class MaterialAdmin(ModelView, model=Material):
            column_list = [Material.id, Material.title, Material.type, Material.slug]

        class MaterialVersionAdmin(ModelView, model=MaterialVersion):
            column_list = [
                MaterialVersion.id,
                MaterialVersion.material_id,
                MaterialVersion.version_number,
            ]

        class TagAdmin(ModelView, model=Tag):
            column_list = [Tag.id, Tag.name, Tag.category]

        class PullRequestAdmin(ModelView, model=PullRequest):
            column_list = [PullRequest.id, PullRequest.title, PullRequest.type, PullRequest.status]

        class PRVoteAdmin(ModelView, model=PRVote):
            column_list = [PRVote.id, PRVote.pr_id, PRVote.user_id, PRVote.value]

        class PRCommentAdmin(ModelView, model=PRComment):
            column_list = [PRComment.id, PRComment.pr_id, PRComment.body]

        class CommentAdmin(ModelView, model=Comment):
            column_list = [Comment.id, Comment.target_type, Comment.target_id, Comment.body]

        class AnnotationAdmin(ModelView, model=Annotation):
            column_list = [Annotation.id, Annotation.material_id, Annotation.body]

        class FlagAdmin(ModelView, model=Flag):
            column_list = [Flag.id, Flag.target_type, Flag.reason, Flag.status]

        class NotificationAdmin(ModelView, model=Notification):
            column_list = [
                Notification.id,
                Notification.user_id,
                Notification.type,
                Notification.title,
            ]

        class ViewHistoryAdmin(ModelView, model=ViewHistory):
            column_list = [ViewHistory.id, ViewHistory.user_id, ViewHistory.material_id]

        admin.add_view(UserAdmin)
        admin.add_view(DirectoryAdmin)
        admin.add_view(MaterialAdmin)
        admin.add_view(MaterialVersionAdmin)
        admin.add_view(TagAdmin)
        admin.add_view(PullRequestAdmin)
        admin.add_view(PRVoteAdmin)
        admin.add_view(PRCommentAdmin)
        admin.add_view(CommentAdmin)
        admin.add_view(AnnotationAdmin)
        admin.add_view(FlagAdmin)
        admin.add_view(NotificationAdmin)
        admin.add_view(ViewHistoryAdmin)
    except ImportError:
        pass
