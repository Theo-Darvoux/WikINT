import asyncio

import typer

app = typer.Typer(help="WikINT CLI")


@app.command()
def seed(
    email: str = typer.Option(..., help="Email for the first Bureau account"),
    role: str = typer.Option("bureau", help="Role to assign"),
) -> None:
    asyncio.run(_seed(email, role))


async def _seed(email: str, role: str) -> None:
    from sqlalchemy import select

    from app.core.database import async_session_factory
    from app.models.directory import Directory, DirectoryType
    from app.models.user import User, UserRole

    async with async_session_factory() as session:
        result = await session.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

        role_enum = UserRole(role)
        if user:
            user.role = role_enum
            typer.echo(f"Updated {email} to role '{role}'")
        else:
            user = User(email=email, role=role_enum)
            session.add(user)
            typer.echo(f"Created user {email} with role '{role}'")

        root_structure = [
            ("1A", [("S1", []), ("S2", [])]),
            ("2A", [("S1", []), ("S2", [])]),
            ("3A", [("S1", []), ("S2", [])]),
        ]

        for year_name, semesters in root_structure:
            result = await session.execute(
                select(Directory).where(
                    Directory.slug == year_name.lower(),
                    Directory.parent_id.is_(None),
                )
            )
            year_dir = result.scalar_one_or_none()
            if not year_dir:
                year_dir = Directory(
                    name=year_name,
                    slug=year_name.lower(),
                    type=DirectoryType.FOLDER,
                    created_by=user.id,
                )
                session.add(year_dir)
                await session.flush()
                typer.echo(f"  Created directory: {year_name}")

            for sem_name, _ in semesters:
                result = await session.execute(
                    select(Directory).where(
                        Directory.slug == sem_name.lower(),
                        Directory.parent_id == year_dir.id,
                    )
                )
                sem_dir = result.scalar_one_or_none()
                if not sem_dir:
                    sem_dir = Directory(
                        name=sem_name,
                        slug=sem_name.lower(),
                        type=DirectoryType.FOLDER,
                        parent_id=year_dir.id,
                        created_by=user.id,
                    )
                    session.add(sem_dir)
                    typer.echo(f"  Created directory: {year_name}/{sem_name}")

        await session.commit()
        typer.echo("Seed complete.")


@app.command()
def reindex() -> None:
    asyncio.run(_reindex())


async def _reindex() -> None:
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.core.database import async_session_factory
    from app.core.meilisearch import meili_client, setup_meilisearch
    from app.models.directory import Directory
    from app.models.material import Material

    from app.services.directory import get_directory_path

    from app.services.directory import get_directory_path

    def split_identifiers(text: str) -> str:
        import re
        if not text:
            return ""
        # Add space between letters and digits
        s = re.sub(r'([a-zA-Z]+)(\d+)', r'\1 \2', text)
        # Add space between digits and letters
        s = re.sub(r'(\d+)([a-zA-Z]+)', r'\1 \2', s)
        return s

    # First ensure indexes exist
    await setup_meilisearch()

    async with async_session_factory() as session:
        # Reindex Materials
        result = await session.execute(
            select(Material).options(selectinload(Material.tags), selectinload(Material.author))
        )
        materials = result.scalars().all()

        m_docs = []
        for mat in materials:
            ancestor_path = ""
            browse_path = "/browse"
            if mat.directory_id:
                path_parts = await get_directory_path(session, mat.directory_id)
                if path_parts:
                    ancestor_path = " ".join(p["name"] for p in path_parts)
                    browse_path += "/" + "/".join(p["slug"] for p in path_parts)
            
            browse_path += f"/{mat.slug}"

            # Build extra searchable fields (identifiers)
            extra = f"{split_identifiers(mat.title)} {split_identifiers(ancestor_path)}"

            m_docs.append({
                "id": str(mat.id),
                "title": mat.title,
                "slug": mat.slug,
                "description": mat.description or "",
                "type": mat.type,
                "tags": [t.name for t in mat.tags] if mat.tags else [],
                "authorName": mat.author.display_name if mat.author else None,
                "directory_id": str(mat.directory_id) if mat.directory_id else None,
                "created_at": mat.created_at.isoformat() if mat.created_at else None,
                "ancestor_path": ancestor_path,
                "extra_searchable": extra,
                "browse_path": browse_path,
            })

        if m_docs:
            await meili_client.index("materials").add_documents(m_docs)
            typer.echo(f"Reindexed {len(m_docs)} materials.")
        else:
            typer.echo("0 materials to reindex.")

        # Reindex Directories
        result = await session.execute(
            select(Directory).options(selectinload(Directory.tags))
        )
        directories = result.scalars().all()

        d_docs = []
        for dir_obj in directories:
            ancestor_path = ""
            browse_path = "/browse"
            if dir_obj.parent_id:
                path_parts = await get_directory_path(session, dir_obj.parent_id)
                if path_parts:
                    ancestor_path = " ".join(p["name"] for p in path_parts)
                    browse_path += "/" + "/".join(p["slug"] for p in path_parts)
            
            browse_path += f"/{dir_obj.slug}"

            metadata = dir_obj.metadata_ or {}
            code = metadata.get("code") or ""
            
            # Build extra searchable fields (identifiers)
            extra = f"{split_identifiers(dir_obj.name)} {split_identifiers(code)} {split_identifiers(ancestor_path)}"

            d_docs.append({
                "id": str(dir_obj.id),
                "name": dir_obj.name,
                "slug": dir_obj.slug,
                "type": dir_obj.type.value if dir_obj.type else "folder",
                "description": dir_obj.description or "",
                "tags": [t.name for t in dir_obj.tags] if dir_obj.tags else [],
                "code": code,
                "parent_id": str(dir_obj.parent_id) if dir_obj.parent_id else None,
                "created_at": dir_obj.created_at.isoformat() if dir_obj.created_at else None,
                "ancestor_path": ancestor_path,
                "extra_searchable": extra,
                "browse_path": browse_path,
            })

        if d_docs:
            await meili_client.index("directories").add_documents(d_docs)
            typer.echo(f"Reindexed {len(d_docs)} directories.")
        else:
            typer.echo("0 directories to reindex.")

    typer.echo("Done reindexing both materials and directories.")


@app.command(name="gdpr-cleanup")
def gdpr_cleanup() -> None:
    """Purge soft-deleted users past the 30-day grace period."""
    asyncio.run(_gdpr_cleanup())


async def _gdpr_cleanup() -> None:
    from app.workers.gdpr_cleanup import gdpr_cleanup as run_cleanup

    await run_cleanup({})
    typer.echo("GDPR cleanup complete.")


@app.command(name="year-rollover")
def year_rollover() -> None:
    """Bump academic years: 1A->2A, 2A->3A+, 3A+ stays."""
    asyncio.run(_year_rollover())


async def _year_rollover() -> None:
    from app.workers.year_rollover import year_rollover as run_rollover

    await run_rollover({})
    typer.echo("Year rollover complete.")


if __name__ == "__main__":
    app()
