"""Inspect a local candidate image without a network or live volume/credential."""
import base64
import hashlib
import json
import re
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

image, commit = sys.argv[1:]
assert re.fullmatch(r"[a-f0-9]{40}", commit)
metadata = json.loads(subprocess.check_output(["docker", "image", "inspect", image]))[0]
config = metadata["Config"]
assert config["User"] == "node"
assert config["Entrypoint"] == ["tini", "--"]
assert config["Cmd"] == ["node", "control/main.mjs"]
assert config["WorkingDir"] == "/app"
assert not any(re.search(r"(?:TOKEN|SECRET|PASSWORD|PROXY|EXTRA_CA|IOS_CONTROL)", v.split("=", 1)[0], re.I)
               for v in config["Env"])


def run(args, values=None, mounts=None):
    command = ["docker", "run", "--rm", "--network=none", "--read-only"]
    for name, value in (values or {}).items():
        command += ["-e", name + "=" + value]
    for mount in mounts or []:
        command += ["--mount", mount]
    return subprocess.run(command + ["--entrypoint", args[0], image] + args[1:],
                          text=True, capture_output=True, timeout=30)


artifact = run(["node", "control/verify-artifact.mjs"])
assert artifact.returncode == 0, artifact.stderr
artifact = json.loads(artifact.stdout)
assert artifact["commit"] == commit
assert artifact["sqliteDependencies"] == "ok"
versions = {}
for command in [["git", "--version"], ["git", "lfs", "version"], ["tini", "--version"]]:
    observed = run(command)
    assert observed.returncode == 0, observed.stderr
    versions[" ".join(command)] = observed.stdout.strip()

# Synthetic keys only. The runner is never started by this image inspection.
fixture = {
    "RAILWAY_PROJECT_ID": "8ac4a414-9f0b-4a90-bcce-4995e5736d9d",
    "RAILWAY_ENVIRONMENT_ID": "bce3bde4-29c1-44e5-8cfe-7400db9f7f51",
    "RAILWAY_SERVICE_ID": "0f673bc3-e433-4641-85a8-12b2678eb040",
    "RAILWAY_GIT_BRANCH": "fix/ios-staging-control-path-001",
    "RAILWAY_GIT_COMMIT_SHA": commit,
    "IOS_CONTROL_RECOVERY_ENABLED": "0",
    "IOS_CONTROL_READER_KEY": "a" * 64,
}
checks = []
for name, changes, success in [
    ("valid_read_only_canary", {}, True),
    ("recovery_enabled", {"IOS_CONTROL_RECOVERY_ENABLED": "1"}, False),
    ("recovery_key_present", {"IOS_CONTROL_RECOVERY_KEY": "b" * 64}, False),
    ("reader_key_missing", {"IOS_CONTROL_READER_KEY": ""}, False),
    ("wrong_project", {"RAILWAY_PROJECT_ID": "wrong"}, False),
    ("wrong_commit", {"RAILWAY_GIT_COMMIT_SHA": "0" * 40}, False),
]:
    observed = run(["node", "control/verify-artifact.mjs", "--canary"], fixture | changes)
    assert (observed.returncode == 0) == success, name
    checks.append({"case": name, "exit_code": observed.returncode, "passed": True})
with tempfile.TemporaryDirectory(prefix="ios-missing-control-") as empty:
    observed = run(["node", "control/verify-artifact.mjs", "--canary"], fixture,
                   ["type=bind,src=" + empty + ",dst=/app/control,readonly"])
    assert observed.returncode != 0 and "MODULE_NOT_FOUND" in observed.stderr
    checks.append({"case": "missing_control_directory", "exit_code": observed.returncode, "passed": True})

history = subprocess.check_output(["docker", "history", "--no-trunc", "--format", "{{json .}}", image])
assert b"proxy_ca" not in history and b"NODE_EXTRA_CA_CERTS" not in history
private_key = re.compile(rb"-----BEGIN (?P<label>(?:[A-Z]+ )?PRIVATE KEY)-----\s+(?P<body>[A-Za-z0-9+/=\r\n]+)-----END (?P=label)-----")
# Public GnuTLS self-test vectors, not credentials. Store DER hashes, never keys.
# https://github.com/gnutls/gnutls/blob/master/lib/crypto-selftests-pk.c
# Reviewed source SHA-256: 81765f415dd7a711bee4ce15ad114e99f8feb30d9f647f546dfc35f287000736
public_self_test_hashes = {
    "803fc9d7eb40ea13dc82723b2d99780ac1e0335ba0b65d660e66994c613ed422",
    "323a1e2a6917c0615aa5e0144ba9ea0b18553c671284f2b75ca5dde1308c477b",
    "87e288dc7dbc29a24241b596ec8c84f949d9f09f34fc0cf69242481fb2274770",
    "d245e52c341a76645e1b0e56c58dc964cd4f3ecaea64a9c6d6db9897d4948a8a",
    "0294b4406902e33bb02f89eaf4c691328790d7a9cd01b873d68edac994f310a1",
    "458022ddcb5598b39253bc027eb02c4f3dba00e2bdbaef239a35bc91c9bd4f3a",
    "09f1c1a4680df80b9e8e6e587d3a787de7402a919e366426ad807a1c0f8c98c1",
    "2859ff03b44c8f0e4f96604b8cced325ef4d01ca935422b2041d88d8809f8fa1",
}
public_self_test_matches = 0
files = 0
with tempfile.TemporaryDirectory(prefix="ios-image-layers-") as directory:
    archive = Path(directory) / "image.tar"
    subprocess.run(["docker", "save", "-o", str(archive), image], check=True)
    with tarfile.open(archive) as saved:
        manifest = json.load(saved.extractfile("manifest.json"))
        layers = manifest[0]["Layers"]
        for layer_name in layers:
            with tarfile.open(fileobj=saved.extractfile(layer_name), mode="r|*") as layer:
                for member in layer:
                    assert "proxy_ca" not in member.name and not member.name.lstrip("./").startswith("run/secrets/"), member.name
                    if not member.isfile():
                        continue
                    files += 1
                    content = layer.extractfile(member).read()
                    for match in private_key.finditer(content):
                        digest = hashlib.sha256(base64.b64decode(re.sub(rb"\s", b"", match["body"]), validate=True)).hexdigest()
                        assert re.fullmatch(r"usr/lib/x86_64-linux-gnu/libgnutls\.so\.[0-9.]+", member.name) and digest in public_self_test_hashes, "Unexpected private-key material: " + member.name
                        public_self_test_matches += 1
                    if Path(member.name).name in (".npmrc", ".netrc"):
                        assert not re.search(rb"(?:_authToken|_auth|password)\s*[= ]\s*\S", content, re.I), member.name

print(json.dumps({
    "task": "IOS-ORCH-STAGING-CONTROL-PATH-001", "commit": commit,
    "image_id": metadata["Id"], "artifact": artifact, "versions": versions,
    "fixture_checks": checks, "network": "none", "live_volume_mounted": False,
    "layer_inspection": {"layers": len(layers), "files": files, "unexpected_private_key_material": 0,
                         "verified_public_gnutls_self_test_matches": public_self_test_matches,
                         "injected_proxy_ca_paths": 0, "credential_config_matches": 0,
                         "history_sha256": hashlib.sha256(history).hexdigest()},
    "passed": True,
}, indent=2))
