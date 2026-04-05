"""PDF security checks and metadata stripping.

Provides:
- check_pdf_safety: structural validation with pikepdf (OpenAction, JavaScript, etc.)
- _apply_pdf_security_strip: strip XMP, /Info, and active content from an open PDF
- _strip_pdf_from_path: path-based strip producing a new temp file
- _compress_pdf_path: path-based Ghostscript compression
"""
import asyncio
import logging
import tempfile
from pathlib import Path
from typing import cast

import pikepdf

from app.core.file_security._concurrency import _get_concurrency_guard
from app.core.sandbox import sandboxed_run

logger = logging.getLogger("wikint")

_PDF_DANGEROUS_ACTION_KEYS = frozenset({
    "/OpenAction", "/AA", "/Launch", "/GoToR", "/URI", "/SubmitForm", "/ImportData",
})


def _walk_page_tree_for_actions(page_node: pikepdf.Dictionary, depth: int = 0) -> None:
    """Recursively walk the PDF page tree checking for dangerous actions."""
    if depth > 50:
        return  # Guard against circular references
    for key in ("/AA", "/Launch", "/GoToR", "/URI", "/SubmitForm", "/ImportData"):
        if pikepdf.Name(key) in page_node:
            raise ValueError(f"PDF page contains dangerous action: {key}")
    if pikepdf.Name("/Kids") in page_node:
        kids = page_node["/Kids"]
        for i in range(len(kids)):
            _walk_page_tree_for_actions(cast(pikepdf.Dictionary, kids[i]), depth + 1)


def check_pdf_safety(file_path: Path) -> None:
    """Raise ValueError for PDFs with auto-executing or JavaScript constructs.

    Checks the document catalog Root for dangerous action keys
    (``/OpenAction``, ``/AA``, ``/Launch``, ``/GoToR``, ``/URI``,
    ``/SubmitForm``, ``/ImportData``), the Names tree for ``/JavaScript``,
    and recursively walks the page tree for per-page action dictionaries.

    Fails open: if pikepdf cannot parse the file, we let YARA handle it.
    Raises ValueError with a human-readable message on detection so the
    worker can report MALICIOUS status.
    """
    try:
        with pikepdf.open(str(file_path), suppress_warnings=True) as pdf:
            root = pdf.Root
            for key in _PDF_DANGEROUS_ACTION_KEYS:
                if pikepdf.Name(key) in root:
                    raise ValueError(
                        f"PDF contains auto-executing action ({key}) and cannot be uploaded."
                    )
            if pikepdf.Name("/Names") in root:
                names_tree = root["/Names"]
                if pikepdf.Name("/JavaScript") in names_tree:
                    raise ValueError("PDF contains embedded JavaScript and cannot be uploaded.")
            if pikepdf.Name("/Pages") in root:
                _walk_page_tree_for_actions(cast(pikepdf.Dictionary, root["/Pages"]))
    except ValueError:
        raise
    except Exception as exc:
        logger.warning("PDF structure malformed, failing closed: %s", exc)
        raise ValueError("File appears malformed or corrupted and cannot be validated for safety.")


def _apply_pdf_security_strip(pdf: pikepdf.Pdf) -> None:
    """Strip metadata and active-content constructs from an open pikepdf document.

    Removes: XMP stream, /Info dict, /OpenAction, catalog /AA,
    /Names//EmbeddedFiles, and per-page /AA entries.
    """
    with pdf.open_metadata():
        pass
    if "/Info" in pdf.trailer:
        del pdf.trailer["/Info"]
    catalog = pdf.Root
    if "/OpenAction" in catalog:
        del catalog["/OpenAction"]
    if "/AA" in catalog:
        del catalog["/AA"]
    if "/Names" in catalog:
        names = catalog["/Names"]
        if "/EmbeddedFiles" in names:
            del names["/EmbeddedFiles"]
    for page in pdf.pages:
        if "/AA" in page:
            del page["/AA"]  # type: ignore[operator]  # pikepdf stubs


def _strip_pdf_from_path(file_path: Path) -> Path:
    """Remove Document Info, XMP metadata, and active content from PDFs on disk."""
    try:
        with pikepdf.open(str(file_path)) as pdf:
            _apply_pdf_security_strip(pdf)
            new_path = tempfile.NamedTemporaryFile(delete=False).name
            pdf.save(new_path)
            return Path(new_path)
    except Exception as exc:
        logger.warning("PDF metadata strip path failed: %s", exc)
        return file_path


async def _compress_pdf_path(file_path: Path) -> Path:
    from app.config import settings as _settings

    gs_quality = _settings.gs_quality
    out_name = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False).name
    try:
        async with _get_concurrency_guard("subprocess"):
            result = await asyncio.to_thread(
                sandboxed_run,
                [
                    "gs",
                    "-sDEVICE=pdfwrite",
                    "-dCompatibilityLevel=1.4",
                    f"-dPDFSETTINGS={gs_quality}",
                    "-dNOPAUSE",
                    "-dQUIET",
                    "-dBATCH",
                    "-dColorImageResolution=72",
                    "-dGrayImageResolution=72",
                    "-dMonoImageResolution=72",
                    f"-sOutputFile={out_name}",
                    str(file_path),
                ],
                rw_paths=[Path(out_name).parent, file_path.parent],
                timeout=60,
            )
        if result.returncode == 0:
            compressed_size = Path(out_name).stat().st_size
            if compressed_size > 0 and compressed_size < file_path.stat().st_size:
                return Path(out_name)
    except Exception:
        Path(out_name).unlink(missing_ok=True)
        raise
    Path(out_name).unlink(missing_ok=True)
    return file_path
