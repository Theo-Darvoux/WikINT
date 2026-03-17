import math
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.core.database import get_db
from app.core.sse import (
    broadcast_to_topic,
    register_topic_queue,
    sse_event_stream,
    unregister_topic_queue,
)
from app.dependencies.auth import CurrentUser, OnboardedUser
from app.dependencies.pagination import PaginationParams
from app.schemas.annotation import (
    AnnotationCreateIn,
    AnnotationOut,
    AnnotationUpdateIn,
    ThreadOut,
)
from app.schemas.common import PaginatedResponse
from app.services.annotation import (
    create_annotation,
    delete_annotation,
    get_annotations,
    update_annotation,
)

material_annotations_router = APIRouter(prefix="/api/materials", tags=["annotations"])
annotations_router = APIRouter(prefix="/api/annotations", tags=["annotations"])


@material_annotations_router.get(
    "/{material_id}/annotations",
    response_model=PaginatedResponse[ThreadOut],
)
async def list_annotations(
    material_id: str,
    pagination: Annotated[PaginationParams, Depends()],
    db: Annotated[AsyncSession, Depends(get_db)],
    version: Annotated[int | None, Query()] = None,
    doc_page: Annotated[int | None, Query(alias="docPage")] = None,
) -> PaginatedResponse[ThreadOut]:
    roots, total = await get_annotations(
        db, material_id, pagination.limit, pagination.offset, version, doc_page
    )
    threads = [
        ThreadOut(
            root=AnnotationOut.model_validate(r),
            replies=[AnnotationOut.model_validate(rep) for rep in r._replies],  # type: ignore[attr-defined]
        )
        for r in roots
    ]
    return PaginatedResponse[ThreadOut](
        items=threads,
        total=total,
        page=pagination.page,
        pages=max(1, math.ceil(total / pagination.limit)),
    )


@material_annotations_router.post(
    "/{material_id}/annotations",
    response_model=AnnotationOut,
    status_code=201,
)
async def add_annotation(
    material_id: str,
    data: AnnotationCreateIn,
    user: OnboardedUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AnnotationOut:
    annotation = await create_annotation(
        db,
        material_id,
        user.id,
        data.body,
        data.selection_text,
        data.position_data,
        data.page,
        data.reply_to_id,
    )
    broadcast_to_topic(material_id, {"type": "annotation_created"})
    return AnnotationOut.model_validate(annotation)


@annotations_router.patch("/{annotation_id}", response_model=AnnotationOut)
async def edit_annotation(
    annotation_id: str,
    data: AnnotationUpdateIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AnnotationOut:
    annotation = await update_annotation(db, annotation_id, user, data.body)
    return AnnotationOut.model_validate(annotation)


@annotations_router.delete("/{annotation_id}", status_code=204)
async def remove_annotation(
    annotation_id: str,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    annotation = await delete_annotation(db, annotation_id, user)
    if annotation:
        broadcast_to_topic(str(annotation.material_id), {"type": "annotation_deleted"})


@material_annotations_router.get("/{material_id}/sse")
async def material_event_stream(material_id: str) -> EventSourceResponse:
    queue = register_topic_queue(material_id)
    return EventSourceResponse(
        sse_event_stream(
            queue,
            cleanup=lambda: unregister_topic_queue(material_id, queue),
        ),
        headers={"X-Accel-Buffering": "no"},
    )
