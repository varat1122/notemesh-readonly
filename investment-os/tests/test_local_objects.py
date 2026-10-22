import hashlib
import os

import pytest

from investment_os.storage.local_objects import ObjectIntegrityError, SyntheticObjectStore


def root_at(tmp_path):
    root = tmp_path / "objects-fixture"
    SyntheticObjectStore.create(root)
    return root


def test_durable_restart_and_content_addressed_hardlink_promotion(tmp_path):
    root = root_at(tmp_path)
    data = b"synthetic,only\n1,2"
    sha = hashlib.sha256(data).hexdigest()
    with SyntheticObjectStore(root) as store:
        store.write_once("quarantine", sha, data)
        store.promote(sha)
    with SyntheticObjectStore(root) as reopened:
        assert reopened.read_verified("objects", sha) == data
        reopened.promote(sha)
    assert (root / "objects" / sha).stat().st_ino == (root / "quarantine" / sha).stat().st_ino
    assert (root / "objects" / sha).stat().st_mode & 0o777 == 0o400


def test_immutable_collision_is_not_overwritten(tmp_path):
    root = root_at(tmp_path)
    with SyntheticObjectStore(root) as store:
        store.write_once("objects", "a" * 64, b"original")
        with pytest.raises(ObjectIntegrityError):
            store.write_once("objects", "a" * 64, b"replacement")
        assert store.read("objects", "a" * 64) == b"original"
    assert not list((root / "objects").glob(".pending-*"))


@pytest.mark.parametrize("target", ["root", "ancestor", "area", "object", "marker"])
def test_symlinks_never_escape_store(tmp_path, target):
    root = root_at(tmp_path)
    secret = tmp_path / "external.txt"
    secret.write_bytes(b"external untouched")
    if target == "root":
        link = tmp_path / "link"
        link.symlink_to(root, target_is_directory=True)
        with pytest.raises(OSError):
            SyntheticObjectStore(link)
    elif target == "ancestor":
        link = tmp_path / "alias"
        link.symlink_to(tmp_path, target_is_directory=True)
        with pytest.raises(OSError):
            SyntheticObjectStore(link / root.name)
    elif target == "area":
        (root / "objects").rmdir()
        (root / "objects").symlink_to(tmp_path, target_is_directory=True)
        with pytest.raises(OSError):
            SyntheticObjectStore(root)
    elif target == "marker":
        (root / ".synthetic-objects").unlink()
        (root / ".synthetic-objects").symlink_to(secret)
        with pytest.raises(OSError):
            SyntheticObjectStore(root)
    else:
        (root / "objects" / ("a" * 64)).symlink_to(secret)
        with SyntheticObjectStore(root) as store, pytest.raises(OSError):
            store.write_once("objects", "a" * 64, b"overwrite")
    assert secret.read_bytes() == b"external untouched"


def test_existing_unmarked_directory_cannot_be_adopted_or_reset(tmp_path):
    root = tmp_path / "existing"
    root.mkdir()
    note = root / "valuable.md"
    note.write_text("preserve")
    with pytest.raises(FileExistsError):
        SyntheticObjectStore.create(root)
    with pytest.raises(FileNotFoundError):
        SyntheticObjectStore(root)
    assert note.read_text() == "preserve"
    assert not (root / ".synthetic-objects").exists()


def test_non_regular_or_insecure_store_rejected(tmp_path):
    root = root_at(tmp_path)
    fifo = root / "objects" / ("a" * 64)
    os.mkfifo(fifo)
    with SyntheticObjectStore(root) as store, pytest.raises(PermissionError):
        store.read("objects", "a" * 64)
    root.chmod(0o755)
    with pytest.raises(PermissionError):
        SyntheticObjectStore(root)


@pytest.mark.parametrize("name", ["../escape", "/absolute", "a/b", "a" * 64 + ".json/../oops"])
def test_internal_paths_cannot_traverse(tmp_path, name):
    with SyntheticObjectStore(root_at(tmp_path)) as store, pytest.raises(PermissionError):
        store.read("objects", name)


def test_replacing_root_path_does_not_redirect_open_directory_descriptors(tmp_path):
    root = root_at(tmp_path)
    moved = tmp_path / "original-root"
    other = tmp_path / "unrelated"
    other.mkdir()
    with SyntheticObjectStore(root) as store:
        root.rename(moved)
        root.symlink_to(other, target_is_directory=True)
        store.write_once("objects", "a" * 64, b"synthetic")
    assert not list(other.iterdir())
    assert (moved / "objects" / ("a" * 64)).read_bytes() == b"synthetic"


def test_corrupted_checkpoint_cannot_be_used_for_resume(tmp_path):
    import json

    root = root_at(tmp_path)
    key = "a" * 64
    with SyntheticObjectStore(root) as store:
        store.journal(key, "prepared", {"actor": "synthetic", "bytes": 10})
        file = root / "journal" / (key + ".prepared")
        envelope = json.loads(file.read_text())
        envelope["payload"]["bytes"] = 20
        file.chmod(0o600)
        file.write_text(json.dumps(envelope))
        with pytest.raises(ObjectIntegrityError, match="checkpoint"):
            store.journal(key, "prepared")
