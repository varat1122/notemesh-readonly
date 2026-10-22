"""Read-only, synthetic-only local filesystem boundary. No write methods in P0."""

import os
import stat
from pathlib import Path

from investment_os.policy.access import (
    Action,
    PermissionRequest,
    Principal,
    authorize,
    safe_relative_path,
)


class SyntheticVaultReader:
    MAX_BYTES = 100_000

    def __init__(self, root: Path):
        self.root = root

    def read(self, principal: Principal, relative_path: str) -> str:
        authorize(principal, PermissionRequest(action=Action.READ, resource_path=relative_path))
        parts = safe_relative_path(relative_path).parts
        # dir_fd + O_NOFOLLOW on each component prevents traversal, symlink and
        # symlink-swap reads. The configured root must be a trusted absolute path.
        root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        current = root_fd
        opened = [root_fd]
        try:
            marker = os.open(
                ".investment-os-synthetic", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd
            )
            with os.fdopen(marker, "rb") as f:
                if f.read(100) != b"P0_SYNTHETIC_VAULT\n":
                    raise PermissionError("only synthetic Vaults are allowed")
            for component in parts[:-1]:
                current = os.open(
                    component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current
                )
                opened.append(current)
            fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=current)
            with os.fdopen(fd, "rb") as f:
                if not stat.S_ISREG(os.fstat(f.fileno()).st_mode):
                    raise PermissionError("regular notes only")
                data = f.read(self.MAX_BYTES + 1)
                if len(data) > self.MAX_BYTES or b"\0" in data:
                    raise ValueError("note too large or binary")
                return data.decode("utf-8")
        finally:
            for fd in reversed(opened):
                os.close(fd)
