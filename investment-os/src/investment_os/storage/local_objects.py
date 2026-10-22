"""POSIX-only, marked synthetic object store with no-follow, durable immutable writes."""

import fcntl
import hashlib
import json
import os
import re
import stat
import time
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from investment_os.domain.canonical import canonical_sha256, canonical_text
from investment_os.ingestion.validation import MAX_BYTES

MARKER = b"INVESTMENT_OS_SYNTHETIC_OBJECTS_V1\n"
AREAS = {"quarantine", "objects", "journal", "locks"}


class ObjectIntegrityError(ValueError):
    pass


def open_directory(path: Path):
    if not path.is_absolute() or ".." in path.parts:
        raise PermissionError("absolute trusted root without traversal required")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def regular(fd):
    if not stat.S_ISREG(os.fstat(fd).st_mode):
        raise PermissionError("regular store file required")


class SyntheticObjectStore:
    @classmethod
    def create(cls, root: Path):
        """Explicitly create a NEW marked root; never adopt or reset an existing directory."""
        parent = open_directory(root.parent)
        try:
            os.mkdir(root.name, mode=0o700, dir_fd=parent)
            os.fsync(parent)
        finally:
            os.close(parent)
        fd = open_directory(root)
        try:
            marker = os.open(
                ".synthetic-objects",
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                0o600,
                dir_fd=fd,
            )
            with os.fdopen(marker, "wb") as handle:
                handle.write(MARKER)
                handle.flush()
                os.fsync(handle.fileno())
            for area in sorted(AREAS):
                os.mkdir(area, mode=0o700, dir_fd=fd)
            os.fsync(fd)
        finally:
            os.close(fd)

    def __init__(self, root: Path):
        self.fds = {}
        fd = open_directory(root)
        self.fds["root"] = fd
        try:
            marker = os.open(
                ".synthetic-objects", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd
            )
            with os.fdopen(marker, "rb") as handle:
                regular(handle.fileno())
                if handle.read(100) != MARKER:
                    raise PermissionError("synthetic store marker required")
            for area in sorted(AREAS):
                self.fds[area] = os.open(
                    area, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd
                )
            for opened in self.fds.values():
                info = os.fstat(opened)
                if info.st_uid != os.getuid() or info.st_mode & 0o077:
                    raise PermissionError("store directories require owner-only access")
        except BaseException:
            self.close()
            raise

    def close(self):
        for fd in self.fds.values():
            os.close(fd)
        self.fds.clear()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def _fd(self, area: str, name: str):
        if area not in AREAS or not re.fullmatch(r"[a-f0-9]{64}(?:\.[a-z]+)?", name):
            raise PermissionError("invalid internal object key")
        return self.fds[area]

    def read(self, area: str, name: str) -> bytes:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=self._fd(area, name))
        with os.fdopen(fd, "rb") as handle:
            regular(handle.fileno())
            data = handle.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ObjectIntegrityError("stored file exceeds limit")
        return data

    def write_once(self, area: str, name: str, data: bytes):
        directory = self._fd(area, name)
        if not 0 < len(data) <= MAX_BYTES:
            raise ValueError("invalid stored byte size")
        temporary = ".pending-" + uuid4().hex
        fd = os.open(
            temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400, dir_fd=directory
        )
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            try:
                # Atomic create-if-absent. A different caller can never replace the target.
                os.link(
                    temporary,
                    name,
                    src_dir_fd=directory,
                    dst_dir_fd=directory,
                    follow_symlinks=False,
                )
                os.fsync(directory)
            except FileExistsError:
                pass
            if self.read(area, name) != data:
                raise ObjectIntegrityError("existing immutable bytes differ")
        finally:
            os.unlink(temporary, dir_fd=directory)
            os.fsync(directory)

    def read_verified(self, area: str, digest: str) -> bytes:
        data = self.read(area, digest)
        if hashlib.sha256(data).hexdigest() != digest:
            raise ObjectIntegrityError("object digest mismatch")
        return data

    def promote(self, digest: str):
        self.read_verified("quarantine", digest)
        try:
            os.link(
                digest,
                digest,
                src_dir_fd=self._fd("quarantine", digest),
                dst_dir_fd=self._fd("objects", digest),
                follow_symlinks=False,
            )
            os.fsync(self.fds["objects"])
        except FileExistsError:
            pass
        self.read_verified("objects", digest)

    def journal(self, key: str, stage: str, value=None):
        name = key + "." + stage
        if value is not None:
            envelope = {"payload": value, "sha256": canonical_sha256(value)}
            self.write_once("journal", name, canonical_text(envelope).encode("utf-8"))
        try:
            envelope = json.loads(self.read("journal", name))
        except FileNotFoundError:
            return None
        if canonical_sha256(envelope["payload"]) != envelope["sha256"]:
            raise ObjectIntegrityError("journal checkpoint digest mismatch")
        return envelope["payload"]

    @contextmanager
    def lock(self, key: str):
        fd = os.open(
            key,
            os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
            0o600,
            dir_fd=self._fd("locks", key),
        )
        try:
            regular(fd)
            deadline = time.monotonic() + 10
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise TimeoutError("capture is busy; retry the same request") from None
                    time.sleep(0.02)
            yield
        finally:
            os.close(fd)
