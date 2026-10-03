"""Reusable validation and safe local storage for uploaded images."""

from io import BytesIO
import os
from pathlib import Path, PurePosixPath
import re
import warnings
from uuid import uuid4

from fastapi import UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError


MAX_IMAGE_BYTES = 5 * 1024 * 1024
BACKEND_ROOT = Path(__file__).resolve().parents[2]
UPLOADS_ROOT = BACKEND_ROOT / "uploads"
_SAFE_COMPONENT = re.compile(r"^[A-Za-z0-9_-]+$")


class ImageTooLargeError(Exception):
    """The uploaded image exceeds the allowed size."""


class InvalidImageError(Exception):
    """The upload is not a valid supported image."""


class ImageStorageError(Exception):
    """The image could not be written to or removed from local storage."""


class ImagePathError(Exception):
    """An image path escapes its assigned upload directory."""


def _image_directory(directory_name: str) -> Path:
    if not _SAFE_COMPONENT.fullmatch(directory_name):
        raise ImagePathError

    uploads_root = UPLOADS_ROOT.resolve()
    directory = (UPLOADS_ROOT / directory_name).resolve()
    if directory.parent != uploads_root:
        raise ImagePathError
    return directory


async def read_image(upload: UploadFile) -> bytes:
    """Read, validate, and normalize a JPEG, PNG, or WEBP upload to WEBP."""

    content = await upload.read(MAX_IMAGE_BYTES + 1)
    if len(content) > MAX_IMAGE_BYTES:
        raise ImageTooLargeError
    if not content:
        raise InvalidImageError

    try:
        # Verification catches truncated or malformed files before decoding pixels.
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"}:
                    raise InvalidImageError
                image.verify()

            with Image.open(BytesIO(content)) as image:
                image.load()
                image = ImageOps.exif_transpose(image)
                mode = "RGBA" if "A" in image.getbands() else "RGB"
                output = BytesIO()
                image.convert(mode).save(output, format="WEBP", quality=85, method=6)
                return output.getvalue()
    except (ImageTooLargeError, InvalidImageError):
        raise
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        UnidentifiedImageError,
        OSError,
        ValueError,
    ):
        raise InvalidImageError from None


def store_image(
    content: bytes,
    directory_name: str,
    prefix: str,
    record_id: int,
) -> tuple[str, Path]:
    """Atomically store normalized image bytes and return a relative path."""

    if not _SAFE_COMPONENT.fullmatch(prefix) or record_id <= 0:
        raise ImagePathError

    directory = _image_directory(directory_name)
    filename = f"{prefix}_{record_id}_{uuid4().hex}.webp"
    destination = directory / filename
    temporary = directory / f".{filename}.tmp"
    try:
        directory.mkdir(parents=True, exist_ok=True)
        # Re-resolve after mkdir to reject a directory replaced by an unsafe symlink.
        if destination.resolve().parent != directory.resolve():
            raise ImagePathError
        temporary.write_bytes(content)
        os.replace(temporary, destination)
    except ImagePathError:
        raise
    except OSError as error:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise ImageStorageError from error

    relative_path = f"uploads/{directory_name}/{filename}"
    return relative_path, destination


def safe_image_path(relative_path: str, directory_name: str) -> Path:
    """Resolve only a direct child of the requested upload directory."""

    path = Path(relative_path)
    if not relative_path or path.is_absolute():
        raise ImagePathError

    directory = _image_directory(directory_name)
    candidate = (BACKEND_ROOT / path).resolve()
    if candidate.parent != directory:
        raise ImagePathError
    return candidate


def remove_image_file(path: Path) -> None:
    """Remove an image only when it is a direct child of an uploads subdirectory."""

    resolved = path.resolve()
    try:
        relative = resolved.relative_to(UPLOADS_ROOT.resolve())
    except ValueError:
        raise ImagePathError from None
    if len(relative.parts) != 2 or resolved.parent.parent != UPLOADS_ROOT.resolve():
        raise ImagePathError

    try:
        resolved.unlink(missing_ok=True)
    except OSError as error:
        raise ImageStorageError from error


def image_url(relative_path: str | None) -> str | None:
    """Convert a persisted relative path into the mounted public uploads URL."""

    if relative_path is None:
        return None
    normalized = relative_path.replace("\\", "/")
    path = PurePosixPath(normalized)
    if (
        path.is_absolute()
        or ".." in path.parts
        or not path.parts
        or path.parts[0] != "uploads"
    ):
        raise ImagePathError
    return f"/{normalized.lstrip('/')}"
