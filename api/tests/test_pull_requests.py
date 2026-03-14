"""Tests for the batch pull request system."""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.directory import Directory
from app.models.material import Material
from app.models.user import User, UserRole
from app.services.pr import topo_sort_operations

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _create_user(
    db: AsyncSession, role: UserRole = UserRole.STUDENT
) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex[:8]}@telecom-sudparis.eu",
        display_name="Tester",
        role=role,
        onboarded=True,
        gdpr_consent=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _create_directory(
    db: AsyncSession, name: str = "TestDir", parent_id: uuid.UUID | None = None, user_id: uuid.UUID | None = None
) -> Directory:
    d = Directory(
        id=uuid.uuid4(),
        name=name,
        slug=name.lower().replace(" ", "-"),
        type="folder",
        parent_id=parent_id,
        created_by=user_id,
    )
    db.add(d)
    await db.flush()
    return d


async def _create_material(
    db: AsyncSession,
    directory_id: uuid.UUID,
    title: str = "TestMat",
    author_id: uuid.UUID | None = None,
) -> Material:
    m = Material(
        id=uuid.uuid4(),
        directory_id=directory_id,
        title=title,
        slug=title.lower().replace(" ", "-"),
        type="document",
        author_id=author_id,
        tags=[],
    )
    db.add(m)
    await db.flush()
    return m


def _auth_headers(user: User) -> dict[str, str]:
    from app.core.security import create_access_token

    token, _ = create_access_token(str(user.id), user.role.value, user.email)
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Unit tests for topo_sort_operations
# ---------------------------------------------------------------------------


class TestTopoSort:
    def test_no_dependencies(self) -> None:
        ops = [
            {"op": "edit_material", "material_id": str(uuid.uuid4())},
            {"op": "edit_material", "material_id": str(uuid.uuid4())},
        ]
        result = topo_sort_operations(ops)
        assert result == ops

    def test_directory_before_material(self) -> None:
        ops = [
            {
                "op": "create_material",
                "temp_id": "$mat-1",
                "directory_id": "$dir-1",
                "title": "File",
                "type": "document",
            },
            {
                "op": "create_directory",
                "temp_id": "$dir-1",
                "name": "Folder",
            },
        ]
        result = topo_sort_operations(ops)
        # directory should come first
        assert result[0]["temp_id"] == "$dir-1"
        assert result[1]["temp_id"] == "$mat-1"

    def test_chain_dependency(self) -> None:
        ops = [
            {
                "op": "create_material",
                "directory_id": "$dir-2",
                "title": "File",
                "type": "document",
            },
            {
                "op": "create_directory",
                "temp_id": "$dir-2",
                "parent_id": "$dir-1",
                "name": "Sub",
            },
            {
                "op": "create_directory",
                "temp_id": "$dir-1",
                "name": "Root",
            },
        ]
        result = topo_sort_operations(ops)
        names = [r.get("name") or r.get("title") for r in result]
        assert names == ["Root", "Sub", "File"]

    def test_cyclic_raises(self) -> None:
        ops = [
            {
                "op": "create_directory",
                "temp_id": "$a",
                "parent_id": "$b",
                "name": "A",
            },
            {
                "op": "create_directory",
                "temp_id": "$b",
                "parent_id": "$a",
                "name": "B",
            },
        ]
        with pytest.raises(Exception, match="Cyclic"):
            topo_sort_operations(ops)

    def test_preserves_order_when_no_deps(self) -> None:
        ops = [
            {"op": "delete_material", "material_id": str(uuid.uuid4())},
            {"op": "edit_directory", "directory_id": str(uuid.uuid4()), "name": "X"},
            {"op": "delete_directory", "directory_id": str(uuid.uuid4())},
        ]
        result = topo_sort_operations(ops)
        assert result == ops


# ---------------------------------------------------------------------------
# Integration tests via HTTP
# ---------------------------------------------------------------------------


class TestCreateBatchPR:
    async def test_single_create_directory_op(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, UserRole.STUDENT)
        await db_session.commit()

        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "Add new folder",
                "operations": [
                    {"op": "create_directory", "name": "NewFolder"},
                ],
            },
            headers=_auth_headers(user),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["type"] == "batch"
        assert data["status"] == "open"
        assert len(data["payload"]) == 1
        assert data["payload"][0]["op"] == "create_directory"
        assert "create_directory" in data["summary_types"]

    async def test_multi_op_batch(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, UserRole.STUDENT)
        d = await _create_directory(db_session, "Existing", user_id=user.id)
        m = await _create_material(db_session, d.id, "ExistingMat", user.id)
        await db_session.commit()

        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "Multi-edit batch",
                "operations": [
                    {"op": "edit_material", "material_id": str(m.id), "title": "Renamed"},
                    {"op": "create_directory", "name": "NewSub", "parent_id": str(d.id)},
                ],
            },
            headers=_auth_headers(user),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert len(data["payload"]) == 2
        assert set(data["summary_types"]) == {"create_directory", "edit_material"}

    async def test_temp_id_batch_with_auto_approve(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """Bureau users get auto-approved; this tests temp_id resolution end-to-end."""
        user = await _create_user(db_session, UserRole.BUREAU)
        await db_session.commit()

        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "Folder + file batch",
                "operations": [
                    {
                        "op": "create_directory",
                        "temp_id": "$dir-1",
                        "name": "BatchFolder",
                    },
                    {
                        "op": "create_material",
                        "temp_id": "$mat-1",
                        "directory_id": "$dir-1",
                        "title": "BatchFile",
                        "type": "document",
                    },
                ],
            },
            headers=_auth_headers(user),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["status"] == "approved"

        # Verify the directory was actually created
        dirs = (
            await db_session.execute(
                select(Directory).where(Directory.name == "BatchFolder")
            )
        ).scalars().all()
        assert len(dirs) == 1

        # Verify material was created with correct directory_id
        mats = (
            await db_session.execute(
                select(Material).where(Material.title == "BatchFile")
            )
        ).scalars().all()
        assert len(mats) == 1
        assert mats[0].directory_id == dirs[0].id

    async def test_duplicate_temp_id_rejected(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, UserRole.STUDENT)
        await db_session.commit()

        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "Duplicate temp_id",
                "operations": [
                    {"op": "create_directory", "temp_id": "$dup", "name": "A"},
                    {"op": "create_directory", "temp_id": "$dup", "name": "B"},
                ],
            },
            headers=_auth_headers(user),
        )
        assert resp.status_code == 422, resp.text

    async def test_empty_operations_rejected(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, UserRole.STUDENT)
        await db_session.commit()

        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "Empty ops",
                "operations": [],
            },
            headers=_auth_headers(user),
        )
        assert resp.status_code == 422, resp.text

    async def test_five_pr_limit(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, UserRole.STUDENT)
        await db_session.commit()

        for i in range(5):
            resp = await client.post(
                "/api/pull-requests",
                json={
                    "title": f"PR {i}",
                    "operations": [
                        {"op": "create_directory", "name": f"Dir{i}"},
                    ],
                },
                headers=_auth_headers(user),
            )
            assert resp.status_code == 200, f"PR {i} failed: {resp.text}"

        # 6th should fail
        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "PR 5",
                "operations": [
                    {"op": "create_directory", "name": "Dir5"},
                ],
            },
            headers=_auth_headers(user),
        )
        assert resp.status_code == 400, resp.text


class TestApproveReject:
    async def test_approve_executes_batch(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        student = await _create_user(db_session, UserRole.STUDENT)
        mod = await _create_user(db_session, UserRole.BUREAU)
        await db_session.commit()

        # Create a PR as student
        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "Needs approval",
                "operations": [
                    {"op": "create_directory", "name": "ApprovedFolder"},
                ],
            },
            headers=_auth_headers(student),
        )
        assert resp.status_code == 200
        pr_id = resp.json()["id"]
        assert resp.json()["status"] == "open"

        # Approve as mod
        resp = await client.post(
            f"/api/pull-requests/{pr_id}/approve",
            headers=_auth_headers(mod),
        )
        assert resp.status_code == 200

        # Verify directory was created
        dirs = (
            await db_session.execute(
                select(Directory).where(Directory.name == "ApprovedFolder")
            )
        ).scalars().all()
        assert len(dirs) == 1

    @patch("app.core.minio.delete_object", new_callable=AsyncMock)
    async def test_reject_cleans_up_files(
        self,
        mock_delete: AsyncMock,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        student = await _create_user(db_session, UserRole.STUDENT)
        mod = await _create_user(db_session, UserRole.BUREAU)
        d = await _create_directory(db_session, "Dir", user_id=student.id)
        await db_session.commit()

        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "With file",
                "operations": [
                    {
                        "op": "create_material",
                        "directory_id": str(d.id),
                        "title": "FileItem",
                        "type": "document",
                        "file_key": "uploads/test.pdf",
                    },
                ],
            },
            headers=_auth_headers(student),
        )
        assert resp.status_code == 200
        pr_id = resp.json()["id"]

        resp = await client.post(
            f"/api/pull-requests/{pr_id}/reject",
            headers=_auth_headers(mod),
        )
        assert resp.status_code == 200
        mock_delete.assert_called_once_with("uploads/test.pdf")


class TestListAndGet:
    async def test_list_prs(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, UserRole.STUDENT)
        await db_session.commit()

        await client.post(
            "/api/pull-requests",
            json={
                "title": "PR A",
                "operations": [
                    {"op": "create_directory", "name": "A"},
                ],
            },
            headers=_auth_headers(user),
        )
        await client.post(
            "/api/pull-requests",
            json={
                "title": "PR B",
                "operations": [
                    {"op": "create_directory", "name": "B"},
                ],
            },
            headers=_auth_headers(user),
        )

        resp = await client.get(
            "/api/pull-requests",
            headers=_auth_headers(user),
        )
        assert resp.status_code == 200
        assert len(resp.json()) >= 2

    async def test_get_pr_by_id(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, UserRole.STUDENT)
        await db_session.commit()

        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "Get me",
                "operations": [
                    {"op": "create_directory", "name": "GetDir"},
                ],
            },
            headers=_auth_headers(user),
        )
        pr_id = resp.json()["id"]

        resp = await client.get(
            f"/api/pull-requests/{pr_id}",
            headers=_auth_headers(user),
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Get me"
        assert resp.json()["payload"][0]["op"] == "create_directory"

    async def test_get_nonexistent_pr(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, UserRole.STUDENT)
        await db_session.commit()

        resp = await client.get(
            f"/api/pull-requests/{uuid.uuid4()}",
            headers=_auth_headers(user),
        )
        assert resp.status_code == 404


class TestVoting:
    async def test_vote_on_pr(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        author = await _create_user(db_session, UserRole.STUDENT)
        voter = await _create_user(db_session, UserRole.STUDENT)
        await db_session.commit()

        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "Vote on me",
                "operations": [
                    {"op": "create_directory", "name": "VoteDir"},
                ],
            },
            headers=_auth_headers(author),
        )
        pr_id = resp.json()["id"]

        resp = await client.post(
            f"/api/pull-requests/{pr_id}/vote?value=1",
            headers=_auth_headers(voter),
        )
        assert resp.status_code == 200
        assert resp.json()["vote_score"] == 1

    async def test_cannot_vote_own_pr(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, UserRole.STUDENT)
        await db_session.commit()

        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "Self vote",
                "operations": [
                    {"op": "create_directory", "name": "SelfDir"},
                ],
            },
            headers=_auth_headers(user),
        )
        pr_id = resp.json()["id"]

        resp = await client.post(
            f"/api/pull-requests/{pr_id}/vote?value=1",
            headers=_auth_headers(user),
        )
        assert resp.status_code == 403


class TestComments:
    async def test_add_comment(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, UserRole.STUDENT)
        await db_session.commit()

        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "Comment PR",
                "operations": [
                    {"op": "create_directory", "name": "CmtDir"},
                ],
            },
            headers=_auth_headers(user),
        )
        pr_id = resp.json()["id"]

        resp = await client.post(
            f"/api/pull-requests/{pr_id}/comments",
            json={"body": "Looks good!"},
            headers=_auth_headers(user),
        )
        assert resp.status_code == 200
        assert resp.json()["body"] == "Looks good!"

    async def test_list_comments(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, UserRole.STUDENT)
        await db_session.commit()

        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "Comment PR",
                "operations": [
                    {"op": "create_directory", "name": "CmtDir2"},
                ],
            },
            headers=_auth_headers(user),
        )
        pr_id = resp.json()["id"]

        await client.post(
            f"/api/pull-requests/{pr_id}/comments",
            json={"body": "Comment 1"},
            headers=_auth_headers(user),
        )
        await client.post(
            f"/api/pull-requests/{pr_id}/comments",
            json={"body": "Comment 2"},
            headers=_auth_headers(user),
        )

        resp = await client.get(
            f"/api/pull-requests/{pr_id}/comments",
            headers=_auth_headers(user),
        )
        assert resp.status_code == 200
        assert len(resp.json()) == 2


class TestDeleteOperations:
    async def test_delete_material_op(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, UserRole.BUREAU)
        d = await _create_directory(db_session, "Dir", user_id=user.id)
        m = await _create_material(db_session, d.id, "ToDelete", user.id)
        await db_session.commit()

        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "Delete material",
                "operations": [
                    {"op": "delete_material", "material_id": str(m.id)},
                ],
            },
            headers=_auth_headers(user),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "approved"

        mat = await db_session.scalar(
            select(Material).where(Material.id == m.id)
        )
        assert mat is None

    async def test_delete_directory_op(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, UserRole.BUREAU)
        d = await _create_directory(db_session, "ToDeleteDir", user_id=user.id)
        await db_session.commit()

        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "Delete dir",
                "operations": [
                    {"op": "delete_directory", "directory_id": str(d.id)},
                ],
            },
            headers=_auth_headers(user),
        )
        assert resp.status_code == 200

        d_check = await db_session.scalar(
            select(Directory).where(Directory.id == d.id)
        )
        assert d_check is None


class TestMoveOperation:
    async def test_move_material(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, UserRole.BUREAU)
        d1 = await _create_directory(db_session, "Source", user_id=user.id)
        d2 = await _create_directory(db_session, "Dest", user_id=user.id)
        m = await _create_material(db_session, d1.id, "Moveable", user.id)
        await db_session.commit()

        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "Move material",
                "operations": [
                    {
                        "op": "move_item",
                        "target_type": "material",
                        "target_id": str(m.id),
                        "new_parent_id": str(d2.id),
                    },
                ],
            },
            headers=_auth_headers(user),
        )
        assert resp.status_code == 200
        await db_session.refresh(m)
        assert m.directory_id == d2.id


class TestEditOperations:
    async def test_edit_material(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, UserRole.BUREAU)
        d = await _create_directory(db_session, "Dir", user_id=user.id)
        m = await _create_material(db_session, d.id, "Old Title", user.id)
        await db_session.commit()

        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "Edit material",
                "operations": [
                    {
                        "op": "edit_material",
                        "material_id": str(m.id),
                        "title": "New Title",
                    },
                ],
            },
            headers=_auth_headers(user),
        )
        assert resp.status_code == 200
        await db_session.refresh(m)
        assert m.title == "New Title"

    async def test_edit_directory(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, UserRole.BUREAU)
        d = await _create_directory(db_session, "OldName", user_id=user.id)
        await db_session.commit()

        resp = await client.post(
            "/api/pull-requests",
            json={
                "title": "Edit dir",
                "operations": [
                    {
                        "op": "edit_directory",
                        "directory_id": str(d.id),
                        "name": "NewName",
                    },
                ],
            },
            headers=_auth_headers(user),
        )
        assert resp.status_code == 200
        await db_session.refresh(d)
        assert d.name == "NewName"
