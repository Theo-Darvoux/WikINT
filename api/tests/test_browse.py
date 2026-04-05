import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.directory import Directory, DirectoryType
from app.models.material import Material, MaterialVersion
from app.models.user import User, UserRole


async def _create_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex[:8]}@telecom-sudparis.eu",
        display_name="Tester",
        role=UserRole.STUDENT,
        onboarded=True,
        gdpr_consent=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _create_directory(
    db: AsyncSession,
    user: User,
    *,
    name: str = "Test Dir",
    slug: str = "test-dir",
    parent_id: uuid.UUID | None = None,
    dir_type: DirectoryType = DirectoryType.FOLDER,
    sort_order: int = 0,
    is_system: bool = False,
) -> Directory:
    directory = Directory(
        id=uuid.uuid4(),
        name=name,
        slug=slug,
        type=dir_type,
        parent_id=parent_id,
        sort_order=sort_order,
        is_system=is_system,
        created_by=user.id,
    )
    db.add(directory)
    await db.flush()
    return directory


async def _create_material(
    db: AsyncSession,
    directory: Directory,
    user: User,
    *,
    title: str = "Test Material",
    slug: str = "test-material",
    mat_type: str = "pdf",
    parent_material_id: uuid.UUID | None = None,
) -> Material:
    material = Material(
        id=uuid.uuid4(),
        directory_id=directory.id,
        title=title,
        slug=slug,
        type=mat_type,
        author_id=user.id,
        parent_material_id=parent_material_id,
    )
    db.add(material)
    await db.flush()
    return material


async def _create_version(
    db: AsyncSession,
    material: Material,
    *,
    version_number: int = 1,
    file_key: str | None = "uploads/test/file.pdf",
    file_name: str | None = "file.pdf",
    file_size: int | None = 1024,
) -> MaterialVersion:
    version = MaterialVersion(
        id=uuid.uuid4(),
        material_id=material.id,
        version_number=version_number,
        file_key=file_key,
        file_name=file_name,
        file_size=file_size,
        file_mime_type="application/pdf",
    )
    db.add(version)
    await db.flush()
    return version


async def test_browse_root_empty(client: AsyncClient, db_session: AsyncSession) -> None:
    response = await client.get("/api/browse")
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "directory_listing"
    assert data["directory"] is None
    assert data["directories"] == []
    assert data["materials"] == []


async def test_browse_root_with_directories(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    await _create_directory(db_session, user, name="Alpha", slug="alpha", sort_order=1)
    await _create_directory(db_session, user, name="Beta", slug="beta", sort_order=0)
    await db_session.commit()

    response = await client.get("/api/browse")
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "directory_listing"
    assert len(data["directories"]) == 2
    assert data["directories"][0]["name"] == "Beta"
    assert data["directories"][1]["name"] == "Alpha"


async def test_browse_root_excludes_system_dirs(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    await _create_directory(db_session, user, name="Visible", slug="visible")
    await _create_directory(db_session, user, name="System", slug="system", is_system=True)
    await db_session.commit()

    response = await client.get("/api/browse")
    assert response.status_code == 200
    data = response.json()
    assert len(data["directories"]) == 1
    assert data["directories"][0]["name"] == "Visible"


async def test_browse_path_directory(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    parent = await _create_directory(db_session, user, name="Parent", slug="parent")
    child = await _create_directory(
        db_session, user, name="Child", slug="child", parent_id=parent.id
    )
    await _create_material(db_session, child, user, title="Note", slug="note")
    await db_session.commit()

    response = await client.get("/api/browse/parent/child")
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "directory_listing"
    assert data["directory"]["name"] == "Child"
    assert len(data["materials"]) == 1
    assert data["materials"][0]["title"] == "Note"


async def test_browse_path_material(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    dir_ = await _create_directory(db_session, user, name="Cours", slug="cours")
    material = await _create_material(db_session, dir_, user, title="Lecture", slug="lecture")
    await _create_version(db_session, material)
    await db_session.commit()

    response = await client.get("/api/browse/cours/lecture")
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "material"
    assert data["material"]["title"] == "Lecture"
    assert data["material"]["current_version_info"] is not None


async def test_browse_path_material_no_version(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    dir_ = await _create_directory(db_session, user, name="Cours", slug="cours")
    await _create_material(db_session, dir_, user, title="Draft", slug="draft")
    await db_session.commit()

    response = await client.get("/api/browse/cours/draft")
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "material"
    assert data["material"]["current_version_info"] is None


async def test_browse_path_attachments(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    dir_ = await _create_directory(db_session, user, name="Cours", slug="cours")
    parent_mat = await _create_material(db_session, dir_, user, title="Main", slug="main")
    await _create_material(
        db_session, dir_, user, title="Annex", slug="annex", parent_material_id=parent_mat.id
    )
    await db_session.commit()

    response = await client.get("/api/browse/cours/main/attachments")
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "attachment_listing"
    assert len(data["materials"]) == 1
    assert data["materials"][0]["title"] == "Annex"


async def test_browse_path_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    response = await client.get("/api/browse/nonexistent")
    assert response.status_code == 404


async def test_browse_path_nested_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    await _create_directory(db_session, user, name="Existing", slug="existing")
    await db_session.commit()

    response = await client.get("/api/browse/existing/missing")
    assert response.status_code == 404


async def test_get_directory_by_id(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    directory = await _create_directory(db_session, user, name="Course", slug="course")
    await db_session.commit()

    response = await client.get(f"/api/directories/{directory.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Course"
    assert data["slug"] == "course"


async def test_get_directory_not_found(client: AsyncClient) -> None:
    fake_id = str(uuid.uuid4())
    response = await client.get(f"/api/directories/{fake_id}")
    assert response.status_code == 404


async def test_get_directory_children(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    parent = await _create_directory(db_session, user, name="Root", slug="root")
    await _create_directory(db_session, user, name="Sub A", slug="sub-a", parent_id=parent.id)
    await _create_material(db_session, parent, user, title="File", slug="file")
    await db_session.commit()

    response = await client.get(f"/api/directories/{parent.id}/children")
    assert response.status_code == 200
    data = response.json()
    assert len(data["directories"]) == 1
    assert data["directories"][0]["name"] == "Sub A"
    assert len(data["materials"]) == 1
    assert data["materials"][0]["title"] == "File"


async def test_get_directory_children_empty(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    directory = await _create_directory(db_session, user, name="Empty", slug="empty")
    await db_session.commit()

    response = await client.get(f"/api/directories/{directory.id}/children")
    assert response.status_code == 200
    data = response.json()
    assert data["directories"] == []
    assert data["materials"] == []


async def test_get_directory_path(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    root = await _create_directory(db_session, user, name="Root", slug="root")
    child = await _create_directory(db_session, user, name="Child", slug="child", parent_id=root.id)
    grandchild = await _create_directory(
        db_session, user, name="Grandchild", slug="grandchild", parent_id=child.id
    )
    await db_session.commit()

    response = await client.get(f"/api/directories/{grandchild.id}/path")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 3
    assert data[0]["name"] == "Root"
    assert data[1]["name"] == "Child"
    assert data[2]["name"] == "Grandchild"


async def test_browse_root_shows_child_counts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    parent = await _create_directory(db_session, user, name="Root", slug="root")
    await _create_directory(db_session, user, name="Sub", slug="sub", parent_id=parent.id)
    await _create_material(db_session, parent, user, title="M1", slug="m1")
    await _create_material(db_session, parent, user, title="M2", slug="m2")
    await db_session.commit()

    response = await client.get("/api/browse")
    assert response.status_code == 200
    data = response.json()
    root_dir = data["directories"][0]
    assert root_dir["child_directory_count"] == 1
    assert root_dir["child_material_count"] == 2
